import type { Env } from "../env.ts";
import { rateLimitedResponse, rateLimitUnavailableResponse } from "../gateway/responses.ts";
import type { RatePolicy } from "../gateway/rate-policy.ts";
import { coarseBurstAllow, nativeLimiterFrom } from "./native-limiter.ts";
import { durableBurstCheck, type RateLimitConfig } from "./rate-limiter.ts";

/**
 * Burst enforcement driven by the route policy (issue #680).
 *
 * Two tiers ride the same classification: a COARSE best-effort wall on the
 * Cloudflare-native ratelimit binding that absorbs floods without a Durable
 * Object round-trip, and the EXACT durable EDGE_GUARD shard where single-key
 * atomic semantics plus a strict failure mode are required. For a high-cost
 * or write class both run: coarse first (best-effort, fails open so a damper
 * outage never 500s), then durable (whose outage the policy turns into a
 * fail-closed 503). For a cacheable public read only the coarse wall runs and
 * FAILS OPEN with an alert (AC4).
 */

/** A rejection to return, or null meaning "proceed/forward". */
export type BurstGuardResult = Response | null;

export const RATE_LIMIT_COARSE_RETRY_AFTER = 60;

/** The coarse native wall for one identity key, the one wall both metered
 * kinds run: a durable class before its shard, a cacheable public read alone.
 * A denied burst resolves to a typed 429; an outage resolves to null (fail
 * open, alerted by `coarseBurstAllow`), never a 500. */
async function coarseWall(env: Env, key: string): Promise<BurstGuardResult> {
  const ok = await coarseBurstAllow(nativeLimiterFrom(env), key);
  if (ok) return null;
  return rateLimitedResponse(RATE_LIMIT_COARSE_RETRY_AFTER);
}

/**
 * Guard one durable high-cost/write class: coarse native wall (best-effort,
 * fail-open) then the exact per-identity durable shard. A durable outage is
 * a fail-CLOSED 503 (AC4); a fair burst window returns a typed 429. Returns a
 * rejection or null to proceed. */
export async function guardDurable(env: Env, key: string, config: RateLimitConfig): Promise<BurstGuardResult> {
  const coarse = await coarseWall(env, key);
  if (coarse !== null) return coarse;
  const verdict = await durableBurstCheck(env.EDGE_GUARD, key, config);
  if (verdict.kind === "allowed") return null;
  if (verdict.kind === "limited") return rateLimitedResponse(verdict.retryAfterSeconds);
  return rateLimitUnavailableResponse();
}

/**
 * Enforce one classified policy cell on an identity key — the SINGLE decision
 * path every routing branch consults (issue #680 review REJECT). The cell's
 * `limiter` kind picks the guard, and with it how the guard fails: durable
 * cells guard via `guardDurable` (fail closed on outage), native cells —
 * cacheable public reads — via the coarse wall alone (fail open + alert, so
 * the read surface never 500s), and unmanaged cells ("none") never touch a
 * binding. No routing branch hand-picks a guard; each passes the cell its
 * route-table entry names and delegates here, so limiter choice and failure
 * mode live in exactly one place.
 */
export async function guardPolicy(env: Env, policy: RatePolicy, key: string, config: RateLimitConfig): Promise<BurstGuardResult> {
  if (policy.limiter === "durable") return guardDurable(env, key, config);
  if (policy.limiter === "native") return coarseWall(env, key);
  return null;
}
