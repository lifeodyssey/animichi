/// <reference types="@cloudflare/workers-types" />

import type { GuardNamespace, GuardStore } from "./guardStore.ts";

/**
 * Per-identity short-window abuse limiter (issue #274 / S1.8).
 *
 * Scope boundary: this is the *burst* control. The per-identity daily message
 * quota (fairness, with its own UI banner) is issue #282 and attaches to the
 * same anonymous identity without touching this module.
 */
export interface RateLimitConfig {
  readonly limit: number;
  readonly windowSeconds: number;
}

export interface WindowState {
  readonly startedAtMs: number;
  readonly count: number;
}

export interface RateLimitDecision {
  readonly allowed: boolean;
  readonly next: WindowState;
  readonly retryAfterSeconds: number;
}

const DEFAULT_LIMIT = 20;
const DEFAULT_WINDOW_SECONDS = 60;
const RATE_LIMIT_KEY = "window";

function positiveInt(raw: unknown, fallback: number): number {
  const parsed = typeof raw === "string" ? Number.parseInt(raw, 10) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/** Read the limiter's window from config; never from a literal in the logic. */
export function rateLimitConfigFrom(env: Record<string, unknown>): RateLimitConfig {
  return {
    limit: positiveInt(env.ANON_RATE_LIMIT, DEFAULT_LIMIT),
    windowSeconds: positiveInt(env.ANON_RATE_LIMIT_WINDOW_SECONDS, DEFAULT_WINDOW_SECONDS),
  };
}

/** Narrow an untyped stored value back to a window, discarding anything else. */
export function parseWindowState(value: unknown): WindowState | null {
  if (typeof value !== "object" || value === null) return null;
  const { startedAtMs, count } = value as Partial<WindowState>;
  if (typeof startedAtMs !== "number" || typeof count !== "number") return null;
  return { startedAtMs, count };
}

function currentWindow(state: WindowState | null, nowMs: number, windowMs: number): WindowState {
  const expired = state === null || nowMs - state.startedAtMs >= windowMs;
  return expired ? { startedAtMs: nowMs, count: 0 } : state;
}

function retryAfter(window: WindowState, nowMs: number, windowMs: number): number {
  return Math.max(1, Math.ceil((window.startedAtMs + windowMs - nowMs) / 1000));
}

/**
 * Advance the fixed window by one request. Pure: the caller injects `nowMs`,
 * so window expiry is exercised with a mocked clock rather than a real sleep.
 * A rejected request does not extend the window (no punitive lockout).
 */
export function stepWindow(
  state: WindowState | null,
  nowMs: number,
  config: RateLimitConfig,
): RateLimitDecision {
  const windowMs = config.windowSeconds * 1000;
  const window = currentWindow(state, nowMs, windowMs);
  const allowed = window.count < config.limit;
  const next = allowed ? { startedAtMs: window.startedAtMs, count: window.count + 1 } : window;
  return { allowed, next, retryAfterSeconds: retryAfter(window, nowMs, windowMs) };
}

/** Read-modify-write one identity's window inside its own DO shard. */
export async function consumeRateLimit(
  store: GuardStore,
  nowMs: number,
  config: RateLimitConfig,
): Promise<RateLimitDecision> {
  const decision = stepWindow(parseWindowState(await store.get(RATE_LIMIT_KEY)), nowMs, config);
  await store.put(RATE_LIMIT_KEY, decision.next);
  return decision;
}

function parseDecision(value: unknown): RateLimitDecision | null {
  if (typeof value !== "object" || value === null) return null;
  const { allowed, retryAfterSeconds } = value as Partial<RateLimitDecision>;
  if (typeof allowed !== "boolean" || typeof retryAfterSeconds !== "number") return null;
  return { allowed, retryAfterSeconds, next: { startedAtMs: 0, count: 0 } };
}

/**
 * Ask the identity's guard shard whether this request may proceed. Sharding by
 * identity keeps each limiter check a single-key transaction on one object.
 */
export async function checkRateLimit(
  guard: GuardNamespace,
  identity: string,
  config: RateLimitConfig,
): Promise<RateLimitDecision | null> {
  const shard = guard.get(guard.idFromName(`rate:${identity}`));
  const response = await shard.fetch(
    new Request("https://edge-guard/rate-limit", {
      method: "POST",
      body: JSON.stringify(config),
    }),
  );
  return response.ok ? parseDecision(await response.json()) : null;
}
