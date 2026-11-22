/**
 * The rate cells of the single rate route policy (issue #680 AC1).
 *
 * Every route in `route-table.ts` names the cell its limiter call meters by, so
 * the route Hono matched IS the request's rate class: there is no second path
 * table to drift from routing. Each cell holds the five properties the program
 * (parent #1004) demands the gateway own:
 *
 *  - identity key  — the meter the request's allowance is spent on (derived
 *    by the caller from worker-verified identity, never a header).
 *  - cost          — high (LLM / outbound-provider / recognition turn) vs low
 *    (a cheap read) so burst and weighted spend stay governable separately.
 *  - quota         — WHICH meter, if any, the op's consumption reports to.
 *    Rate limit (this module's burst window) and daily/billing quota are
 *    SEPARATE concerns (AC3): a 429 never claims to be quota exhaustion and
 *    vice versa.
 *  - retry contract — a typed 429 carrying `Retry-After` + the documented
 *    rate-limit fields for limited classes; none for unmanaged reads.
 *  - failure mode  — high-cost and mutation classes FAIL CLOSED (AC4);
 *    cacheable public reads FAIL OPEN with an alert.
 *
 * The primitive tier matches the issue: COARSE burst classes ride the
 * Cloudflare-native `ratelimit` binding (`limiter: "native"` — best-effort,
 * multi-PoP, no durable round-trip), while exact high-cost/write semantics keep
 * durable coordination in the `EDGE_GUARD` Durable Object (`limiter:
 * "durable"`) where single-key atomicity and a strict fail-closed policy are
 * what the cost demands.
 *
 * Pure module — no bindings, no clock — so it runs under node:test.
 */

export type CostGrade = "high" | "low";
export type QuotaKind = "none" | "daily-message" | "daily-cost" | "billing";
export type LimiterKind = "none" | "native" | "durable";
export type LimiterFailure = "fail-open-alert" | "fail-closed";

export interface RatePolicy {
  readonly cost: CostGrade;
  readonly quota: QuotaKind;
  readonly limiter: LimiterKind;
  readonly failure: LimiterFailure;
}

export const RATE_LIMIT_ENVELOPE_FIELDS = ["code", "message", "retry_after_seconds"] as const;

export const UNMANAGED_READ: RatePolicy = Object.freeze({ cost: "low", quota: "none", limiter: "none", failure: "fail-open-alert" });
export const NATIVE_PUBLIC_READ: RatePolicy = Object.freeze({ cost: "low", quota: "none", limiter: "native", failure: "fail-open-alert" });
export const DURABLE_HIGH_COST: RatePolicy = Object.freeze({ cost: "high", quota: "none", limiter: "durable", failure: "fail-closed" });
/** BYOK is a high-cost durable class whose consumption reports to the caller's
 * BILLING meter, never the anonymous daily budget/message quota (AC5): it may
 * raise billing quota but can never bypass the abuse burst limiter. */
export const DURABLE_BYOK: RatePolicy = Object.freeze({ cost: "high", quota: "billing", limiter: "durable", failure: "fail-closed" });
/** Service credentials (API machine identity) get a SEPARATE policy cell from
 * users and anonymous callers (AC5). No service credential is wired into
 * routing today (the legacy api_keys path was deleted), but the class is
 * modelled so abuse policy for machine identity stays distinct and never
 * silently merges into the per-user cell. */
const SERVICE_CREDENTIAL: RatePolicy = Object.freeze({ cost: "high", quota: "billing", limiter: "durable", failure: "fail-closed" });
export const DURABLE_USER_MUTATION: RatePolicy = Object.freeze({ cost: "low", quota: "none", limiter: "durable", failure: "fail-closed" });
export const DURABLE_ADOPT: RatePolicy = Object.freeze({ cost: "low", quota: "none", limiter: "durable", failure: "fail-closed" });

/** The identity-key prefix for a SERVICE credential — separate from users
 * (authed:) and anonymous (anon_) so machine identity never shares a limiter
 * with a human (AC5). Not wired into a route today; kept so the policy cell
 * and its key never drift. */
export const SERVICE_CREDENTIAL_KEY_PREFIX = "svc:";

export function serviceCredentialKey(credentialId: string): string {
  return `${SERVICE_CREDENTIAL_KEY_PREFIX}${credentialId}`;
}

export function serviceCredentialPolicy(): RatePolicy {
  return SERVICE_CREDENTIAL;
}
