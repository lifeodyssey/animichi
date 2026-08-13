import { AGENT_PATHS } from "@animichi/contract/agent-contract";
import { USERS_BINDING_PREFIX } from "@animichi/contract/internal-binding";
import { isPublicV1 } from "./routing-policy.ts";

/**
 * The single rate route policy (issue #680 AC1).
 *
 * Every public API operation the edge serves — agent /v1, users /v1, and the
 * one allowlisted public catalog read — is classified by the five cells the
 * program (parent #1004) demands the gateway own:
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

const UNMANAGED_READ: RatePolicy = Object.freeze({ cost: "low", quota: "none", limiter: "none", failure: "fail-open-alert" });
const NATIVE_PUBLIC_READ: RatePolicy = Object.freeze({ cost: "low", quota: "none", limiter: "native", failure: "fail-open-alert" });
const DURABLE_HIGH_COST: RatePolicy = Object.freeze({ cost: "high", quota: "none", limiter: "durable", failure: "fail-closed" });
/** BYOK is a high-cost durable class whose consumption reports to the caller's
 * BILLING meter, never the anonymous daily budget/message quota (AC5): it may
 * raise billing quota but can never bypass the abuse burst limiter. */
const DURABLE_BYOK: RatePolicy = Object.freeze({ cost: "high", quota: "billing", limiter: "durable", failure: "fail-closed" });
/** Service credentials (API machine identity) get a SEPARATE policy cell from
 * users and anonymous callers (AC5). No service credential is wired into
 * routing today (the legacy api_keys path was deleted), but the class is
 * modelled so abuse policy for machine identity stays distinct and never
 * silently merges into the per-user cell. */
const SERVICE_CREDENTIAL: RatePolicy = Object.freeze({ cost: "high", quota: "billing", limiter: "durable", failure: "fail-closed" });
const DURABLE_MUTATION: RatePolicy = Object.freeze({ cost: "low", quota: "none", limiter: "durable", failure: "fail-closed" });
const DURABLE_USER_MUTATION: RatePolicy = Object.freeze({ cost: "low", quota: "none", limiter: "durable", failure: "fail-closed" });
const DURABLE_ADOPT: RatePolicy = Object.freeze({ cost: "low", quota: "none", limiter: "durable", failure: "fail-closed" });

const HIGH_COST_V1 = new Set(["/v1/chat", "/v1/photo-search"]);
const PUBLIC_CATALOG_PATTERN = /^\/catalog\/public\/anime-overview\/\d+$/;

/** Derive the BYOK prefix from the inventory's byok route so every current and
 * future /v1/byok/* route stays on the durable billing abuse class (AC5)
 * without an edit here. */
function byokPrefixFromInventory(): string {
  const probe = AGENT_PATHS.find((entry) => entry.path.startsWith("/v1/byok/"));
  if (probe === undefined) {
    throw new Error("AGENT_PATHS has no /v1/byok/ route; cannot derive the BYOK rate-limit prefix");
  }
  return probe.path.slice(0, probe.path.lastIndexOf("/") + 1);
}

const BYOK_PREFIX = byokPrefixFromInventory();

function templatePattern(template: string): RegExp {
  const escaped = template.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const parametric = escaped.replace(/\\{[^}]*\\}/g, "[^/]+");
  return new RegExp("^" + parametric + "$");
}

type AgentPathEntry = (typeof AGENT_PATHS)[number];

function agentRule(entry: AgentPathEntry): RatePolicy {
  if (entry.method === "POST") {
    if (entry.path.startsWith("/v1/byok/")) return DURABLE_BYOK;
    if (HIGH_COST_V1.has(entry.path)) return DURABLE_HIGH_COST;
    return DURABLE_MUTATION;
  }
  if (entry.method === "PATCH") return DURABLE_MUTATION;
  return UNMANAGED_READ;
}

/** Percent-decode then strip ONE trailing slash, mirroring the routing
 * policy's own normalization so a %XX-encoded or "/"-suffixed class can
 * never be dropped out of the table (AC2). Decoding FAILS, `decodable` is
 * false and the RAW pathname is returned so classifyRatePolicy can fail
 * CLOSED on a malformed escape: an evade-shaped input is exactly what must
 * not sneak out of the decision table as an unmanaged read. */
function normalizePathname(pathname: string): { readonly path: string; readonly decodable: boolean } {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return { path: pathname, decodable: false };
  }
  return { path: decoded.length > 1 && decoded.endsWith("/") ? decoded.slice(0, -1) : decoded, decodable: true };
}

export function classifyRatePolicy(method: string, pathname: string): RatePolicy {
  const { path: normalized, decodable } = normalizePathname(pathname);
  if (isPublicV1(normalized)) return NATIVE_PUBLIC_READ;
  if (PUBLIC_CATALOG_PATTERN.test(normalized)) return NATIVE_PUBLIC_READ;
  if (pathname.startsWith(USERS_BINDING_PREFIX)) {
    return method === "GET" ? UNMANAGED_READ : DURABLE_USER_MUTATION;
  }
  if (pathname === "/v1/sessions/adopt") return DURABLE_ADOPT;
  if (pathname.startsWith("/v1/")) {
    // A /v1 path whose %-escape does not parse is an evade-shaped input: it
    // must FAIL CLOSED as a durable mutation, never classify unmanaged and
    // slip out of the meter (P2-5 / #479 round-3).
    if (!decodable) return DURABLE_MUTATION;
    // BYOK matches by prefix (AC5), not an exact list, so future /v1/byok/*
    // outbound relays never silently fall out of the abuse limiter.
    if (normalized.startsWith(BYOK_PREFIX)) return DURABLE_BYOK;
    const matched = AGENT_PATHS.find((candidate) =>
      candidate.method === method && templatePattern(candidate.path).test(normalized),
    );
    return matched ? agentRule(matched) : UNMANAGED_READ;
  }
  return UNMANAGED_READ;
}
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
