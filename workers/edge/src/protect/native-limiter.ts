import type { Env } from "../env.ts";

/**
 * Cloudflare-native `ratelimit` binding seam (issue #680).
 *
 * The binding (`env.RATE_LIMITER`) is the platform's best-effort counter: a
 * Coarse Burst Damper shared across every PoP, no Durable Object round-trip.
 * `limit({ key })` resolves `{ success }`; `success === false` means the key
 * already exceeded the configured window. It is a COARSE/BEST-EFFORT control
 * (the issue's intent) so its own absence or a thrown call is never treated
 * as a hard failure: the strict fail-closed guarantee belongs to the durable
 * tier (`EDGE_GUARD`), not here.
 */
export interface NativeRateLimiter {
  readonly limit: (key: string) => Promise<{ readonly success: boolean }>;
}

/** Adapter over the deployed CF binding; `null` when the binding is absent
 * (unit tests, preview, a config without the binding) so callers fail open. */
export function nativeLimiterFrom(env: Env): NativeRateLimiter | null {
  const binding = env.RATE_LIMITER;
  if (binding === undefined) return null;
  return { limit: (key) => binding.limit({ key }) };
}

/** The single fail-open OUTAGE alert event for the native damper (AC4):
 * emitted when a cacheable read bypasses a limiter outage so the operator
 * still hears about it. ONE event name lives here; every fail-open call
 * site routes through it (burst-guard's guardNativeRead included). */
export function alertNativeRateLimitOutage(key: string): void {
  console.warn(JSON.stringify({ event: "edge_native_rate_limit_alert", key }));
}

/** Run one coarse native burst check, FAILING OPEN on any unavailability: a
 * null binding, a thrown call, or a rejected promise is an ALERTED OUTAGE
 * (via alertNativeRateLimitOutage), not a denial. Resolves `true` to
 * proceed, `false` when the coarse window is already exceeded. */
export async function coarseBurstAllow(limiter: NativeRateLimiter | null, key: string): Promise<boolean> {
  if (limiter === null) return true;
  try {
    const outcome = await limiter.limit(key);
    return outcome.success;
  } catch {
    alertNativeRateLimitOutage(key);
    return true;
  }
}
