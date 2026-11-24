/// <reference types="@cloudflare/workers-types" />

import {
  budgetGuidanceResponse,
  readBudgetLatch,
  utcDayKey,
  writeBudgetLatch,
} from "./cost-breaker.ts";
import { z } from "zod";
import { durableGuardStore, type GuardStore } from "./guard-store.ts";
import {
  consumeRateLimit,
  parseWindowState,
  RATE_LIMIT_KEY,
  rateLimitConfigFrom,
  type RateLimitConfig,
  WindowSeconds,
  type WindowState,
} from "./rate-limiter.ts";

/**
 * Strongly-consistent state for the edge guards (issue #274 / S1.8).
 *
 * A Durable Object rather than KV: both guards are read-modify-write counters
 * whose whole purpose is to be correct under concurrency, and KV is eventually
 * consistent with a 60s edge cache — it cannot express a per-second window.
 * Rate-limit shards are keyed by identity (`rate:<id>`), so each check is a
 * single-key transaction on one object; the breaker latch uses one global shard.
 */
function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    headers: { "Content-Type": "application/json" },
  });
}

/** The limiter config a `/rate-limit` body carries: finite numbers, the window within `WindowSeconds`' bound.
 * Keys beyond the two are dropped, because a newer version may write extra fields during a rolling deploy. */
const RequestedConfig = z.object({ limit: z.number(), windowSeconds: WindowSeconds });

export function parseConfig(value: unknown, fallback: RateLimitConfig): RateLimitConfig {
  const parsed = RequestedConfig.safeParse(value);
  return parsed.success ? parsed.data : fallback;
}

/** One `/rate-limit` check of the shard's window under `config`. */
async function rateLimitAnswer(store: GuardStore, nowMs: number, config: RateLimitConfig): Promise<Response> {
  const decision = await consumeRateLimit(store, nowMs, config);
  return jsonResponse({ allowed: decision.allowed, retryAfterSeconds: decision.retryAfterSeconds });
}

export async function handleRateLimit(
  request: Request,
  store: GuardStore,
  nowMs: number,
  fallback: RateLimitConfig,
): Promise<Response> {
  return rateLimitAnswer(store, nowMs, parseConfig(await request.json(), fallback));
}

export async function handleBudget(
  request: Request,
  store: GuardStore,
  nowMs: number,
): Promise<Response> {
  const dayKey = new URL(request.url).searchParams.get("dayKey") ?? utcDayKey(nowMs);
  if (request.method === "POST") await writeBudgetLatch(store, dayKey);
  return jsonResponse({ latched: await readBudgetLatch(store, dayKey) });
}

/** Route one guard request; exported so tests drive it without a live DO. */
export function handleGuardRequest(
  request: Request, store: GuardStore, nowMs: number, fallback: RateLimitConfig,
): Promise<Response> {
  const { pathname } = new URL(request.url);
  if (pathname === "/rate-limit") return handleRateLimit(request, store, nowMs, fallback);
  if (pathname === "/budget") return handleBudget(request, store, nowMs);
  return Promise.resolve(new Response("Not found", { status: 404 }));
}

export { budgetGuidanceResponse };

/** Only a `/rate-limit` request reclaims its shard. The daily budget shard
 * is a fixed, separate DO instance (`idFromName("budget")`, cost-breaker.ts)
 * that never receives this pathname, so it is never at risk of being armed
 * or swept below. */
export function isRateLimitPath(pathname: string): boolean {
  return pathname === "/rate-limit";
}

/** A per-identity rate-limit shard is stale exactly one window after its
 * last write; reclaiming it two windows out (issue #284 / Task 9, P2-3)
 * bounds the storage a forgotten/abandoned identity's shard occupies. */
export function reclaimDelayMs(windowSeconds: number): number {
  return 2 * windowSeconds * 1_000;
}

export const RECLAIM_WINDOW_KEY = "reclaim-window-seconds";

/** A recorded reclaim basis the alarm can use: a positive window within `WindowSeconds`' bound. */
const RecordedReclaimWindow = WindowSeconds.positive();

/** Recover the window basis the reclaim alarm was armed with; falls back to
 * the shard's own config if nothing usable was recorded: nothing at all (a
 * shard that never saw a /rate-limit request has no alarm to fire in the first
 * place), or a value that is not a positive, finite window within the bound. */
function parseReclaimWindow(value: unknown, fallback: number): number {
  const parsed = RecordedReclaimWindow.safeParse(value);
  return parsed.success ? parsed.data : fallback;
}

/**
 * The conservative window basis for the reclaim alarm: the wider of the
 * shard's fallback config and whatever config THIS request applied
 * (issue #284 / Task 9, P1-3). Using the fallback alone let a wider
 * AUTH_RATE_LIMIT_WINDOW_SECONDS get its shard deleted mid-window — e.g.
 * ANON=60s/AUTH=3600s scheduled the alarm for 120s, well inside an
 * authenticated identity's still-live hour-long window.
 */
function reclaimWindowSeconds(applied: RateLimitConfig, fallback: RateLimitConfig): number {
  return Math.max(applied.windowSeconds, fallback.windowSeconds);
}

export class EdgeGuard {
  private readonly storage: DurableObjectStorage;
  private readonly store: GuardStore;
  private readonly fallback: RateLimitConfig;

  constructor(ctx: DurableObjectState, env: Record<string, unknown>) {
    this.storage = ctx.storage;
    this.store = durableGuardStore(ctx.storage);
    this.fallback = rateLimitConfigFrom(env);
  }

  /** A `/rate-limit` body is read once, and the config it carries serves both
   * the check and the reclaim alarm. A body that is not JSON rejects here,
   * before anything is stored or armed. */
  async fetch(request: Request): Promise<Response> {
    if (!isRateLimitPath(new URL(request.url).pathname)) return handleGuardRequest(request, this.store, Date.now(), this.fallback);
    const applied = parseConfig(await request.json(), this.fallback);
    const response = await rateLimitAnswer(this.store, Date.now(), applied);
    await this.armReclaim(reclaimWindowSeconds(applied, this.fallback));
    return response;
  }

  /** Arm only if nothing is scheduled yet (P2-4): unconditional `setAlarm`
   * on every request is a write per request, more than the mechanism saves. */
  private async armReclaim(windowSeconds: number): Promise<void> {
    if ((await this.storage.getAlarm()) !== null) return;
    await this.store.put(RECLAIM_WINDOW_KEY, windowSeconds);
    await this.storage.setAlarm(Date.now() + reclaimDelayMs(windowSeconds));
  }

  /** Rearm while the window is still live; otherwise reclaim the shard keys. */
  private async reclaimOrDelete(windowSeconds: number, state: WindowState | null): Promise<void> {
    const stillFresh = state !== null && Date.now() - state.startedAtMs < windowSeconds * 1_000;
    if (stillFresh) {
      await this.storage.setAlarm(Date.now() + reclaimDelayMs(windowSeconds));
      return;
    }
    await this.storage.delete(RATE_LIMIT_KEY);
    await this.storage.delete(RECLAIM_WINDOW_KEY);
  }

  /** If a later request reset the window since arming, rearm instead of
   * deleting (P2-4). Otherwise a targeted `storage.delete`, never
   * `deleteAll` — the budget shard's isolation is a static guarantee here. */
  async alarm(): Promise<void> {
    const windowSeconds = parseReclaimWindow(await this.store.get(RECLAIM_WINDOW_KEY), this.fallback.windowSeconds);
    const state = parseWindowState(await this.store.get(RATE_LIMIT_KEY));
    await this.reclaimOrDelete(windowSeconds, state);
  }
}
