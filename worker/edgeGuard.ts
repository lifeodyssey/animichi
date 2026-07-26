/// <reference types="@cloudflare/workers-types" />

import {
  budgetGuidanceResponse,
  readBudgetLatch,
  utcDayKey,
  writeBudgetLatch,
} from "./costBreaker.ts";
import { durableGuardStore, type GuardStore } from "./guardStore.ts";
import { consumeRateLimit, rateLimitConfigFrom, type RateLimitConfig } from "./rateLimiter.ts";

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

function parseConfig(value: unknown, fallback: RateLimitConfig): RateLimitConfig {
  if (typeof value !== "object" || value === null) return fallback;
  const { limit, windowSeconds } = value as Partial<RateLimitConfig>;
  if (typeof limit !== "number" || typeof windowSeconds !== "number") return fallback;
  return { limit, windowSeconds };
}

export async function handleRateLimit(
  request: Request,
  store: GuardStore,
  nowMs: number,
  fallback: RateLimitConfig,
): Promise<Response> {
  const config = parseConfig(await request.json(), fallback);
  const decision = await consumeRateLimit(store, nowMs, config);
  return jsonResponse({ allowed: decision.allowed, retryAfterSeconds: decision.retryAfterSeconds });
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
  request: Request,
  store: GuardStore,
  nowMs: number,
  fallback: RateLimitConfig,
): Promise<Response> {
  const { pathname } = new URL(request.url);
  if (pathname === "/rate-limit") return handleRateLimit(request, store, nowMs, fallback);
  if (pathname === "/budget") return handleBudget(request, store, nowMs);
  return Promise.resolve(new Response("Not found", { status: 404 }));
}

export { budgetGuidanceResponse };

export class EdgeGuard {
  private readonly store: GuardStore;
  private readonly fallback: RateLimitConfig;

  constructor(ctx: DurableObjectState, env: Record<string, unknown>) {
    this.store = durableGuardStore(ctx.storage);
    this.fallback = rateLimitConfigFrom(env);
  }

  fetch(request: Request): Promise<Response> {
    return handleGuardRequest(request, this.store, Date.now(), this.fallback);
  }
}
