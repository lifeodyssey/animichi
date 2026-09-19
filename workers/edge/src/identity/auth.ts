/// <reference types="@cloudflare/workers-types" />

import {
  type IdentityClass,
  type IdentityClassPolicy,
  type IdentityPolicy,
} from "@animichi/contract/identity";
import { verifyEdDsaJwt } from "@animichi/contract/jwt";
import { createRemoteJWKSet, customFetch } from "jose";

/**
 * Identity classes the agent tier may be told about. `"anonymous"` (issue #274)
 * is NOT an authentication result — it is an *unauthenticated but identified*
 * caller, minted by the edge so open surfaces can still be rate-limited and
 * metered per client. `authenticate()` never returns it.
 */
export type UserType = "human" | "anonymous";

/**
 * The explicit identity matrix (AUTH-1 #945): how a /v1 request is classified
 * and the numeric configuration each class is governed by.
 *
 *  - `"public"`       — allowlisted read routes: no credential, no limiter,
 *                       no quota, no budget. No `/v1` path reaches this class
 *                       since #1597 retired the last three public reads; the
 *                       class stays in the deployed matrix (and its
 *                       `wrangler.toml` pin) until the matrix itself retires.
 *  - `"anonymous"`    — no credential + the anonymous allowlist (ANON_V1):
 *                       worker-minted identity, burst-limited, daily-quota'd,
 *                       daily-budgeted.
 *  - `"authenticated"` — a verified human JWT: burst-limited on cost-bearing
 *                        paths only; no anonymous quota/budget.
 *
 * The path -> class classification stays in gateway/routing-policy.ts; this
 * module owns the classes and the policy document they consume.
 */
export type { IdentityClass, IdentityClassPolicy, IdentityPolicy };

// The deployed matrix, taken off the contract's import-free module: this
// Worker reads the numbers at runtime, and `@animichi/contract/identity` would
// bring zod's whole module graph into the bundle for them (#1285,
// `bundle-smoke/entry-bundle.test.ts`). The schemas that validate the document
// stay in the contract, where the tests that parse it import them directly.
export { DEFAULT_IDENTITY_POLICY } from "@animichi/contract/identity-policy";

/**
 * Why authentication produced no identity (issues #441, #452).
 *
 * - `"absent"` — the caller presented no bearer credential at all. Only this
 *   case may fall through to the anonymous handler.
 * - `"invalid"` — a bearer credential WAS presented and was SHOWN to be no
 *   good: expired, malformed, wrong issuer/audience/algorithm, or signed by a
 *   key the issuer does not publish. Silently demoting it to an anonymous
 *   identity hides the expiry from the client and charges the turn to the wrong
 *   meter, so it must 401 — and 401 is the right answer here, because the
 *   client's own re-authentication fixes it.
 * - `"unverifiable"` — a credential was presented and we could not CHECK it:
 *   the JWKS fetch threw, timed out, or did not answer 200, so the key set the
 *   verdict needs never arrived (#452). The credential may be perfectly good.
 *   Answering 401 here tells every caller its token is stale, so each clears it
 *   and re-authenticates against the same outage — a refresh loop lasting
 *   exactly as long as the outage. `detail` names the acquisition failure, so an
 *   outage is diagnosable from a log line rather than from a support report.
 *
 * A non-Bearer `Authorization` scheme is `"absent"`: this edge has never
 * accepted one, so an unrelated header must not start 401ing.
 */
export type AuthResult =
  | { ok: true; userId: string; userType: "human" }
  | { ok: false; reason: "absent" }
  | { ok: false; reason: "invalid" }
  | { ok: false; reason: "unverifiable"; detail: string };

/** The failing half of `AuthResult`, for the gateway's rejection branch. */
export type AuthFailure = Extract<AuthResult, { ok: false }>;

/** Derived rather than re-spelled: the reasons are declared once, above. */
export type AuthFailureReason = AuthFailure["reason"];

// Frozen because both are module-level singletons shared by every request on
// the isolate: a stray mutation would poison the verdict for all of them.
const ABSENT: AuthResult = Object.freeze({ ok: false, reason: "absent" });
const INVALID: AuthResult = Object.freeze({ ok: false, reason: "invalid" });

/** Built per call rather than frozen: `detail` is the acquisition failure's own,
 * and it is what makes an outage readable from a log line (issue #452). */
function unverifiable(detail: string): AuthResult {
  return { ok: false, reason: "unverifiable", detail };
}

/**
 * A JWKS package that never arrived: the fetch threw, timed out, or did not
 * answer 200. That is a failure of the key material the verdict needs — never a
 * verdict on the credential — and telling the two apart is the whole of #452.
 */
class JwksUnavailable extends Error {
  readonly detail: string;

  constructor(detail: string, options?: ErrorOptions) {
    super(`JWKS unavailable: ${detail}`, options);
    this.name = "JwksUnavailable";
    this.detail = detail;
  }
}

/**
 * The acquisition boundary, and the one place a key-set failure is attributed.
 * jose resolves a remote key set by calling this fetch, so a throw from here is
 * unambiguous: the key set was never obtained, on the first fetch and on every
 * cached-refresh attempt after it. Whatever jose throws once a package HAS
 * arrived — a set holding no key for the token's `kid`, a signature that does
 * not check out — is a verdict on the credential, which is why
 * `JWKSNoMatchingKey` must reach `verifyNeonIdentity` and be answered `INVALID`.
 */
function jwksAcquisition(f: typeof fetch): typeof fetch {
  return async (input, init) => {
    const response = await attemptedJwks(f, input, init);
    if (response.status !== 200) throw new JwksUnavailable(`status ${String(response.status)}`);
    return response;
  };
}

/**
 * One transport attempt at the key set: a refused connection, a timeout, an
 * abort. `detail` is the error's NAME, never its message (the rule
 * `gatewayFailure` logs under).
 */
async function attemptedJwks(f: typeof fetch, input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  try {
    return await f(input, init);
  } catch (cause) {
    throw new JwksUnavailable(cause instanceof Error ? cause.name : "unknown", { cause });
  }
}

/**
 * The `Bearer` auth-scheme, matched per RFC 7235 §2.1: the scheme token is
 * case-insensitive, and the separator may be any run of SP/HTAB. Anything
 * else — `Basic`, `Bearerish`, a bare scheme — is not our credential format.
 */
export const BEARER_SCHEME = /^bearer[ \t]+/i;

/**
 * AUTH-2 #950: the edge verifies Neon Auth JWTs and nothing else. The
 * Supabase verifier, the `NEON_AUTH_ENABLED` activation flag and the split
 * `NEON_AUTH_ISSUER` var are deleted — the branch's JWKS URL is the single
 * source of truth, and the issuer/audience are derived from it (the same
 * derivation the retired `workers/users/src/auth/jwt.ts` used).
 */
export interface AuthEnv {
  NEON_AUTH_JWKS_URL?: string;
}

export type { AnonymousEnv } from "./anonymous-id.ts";
export {
  ANON_ID_PREFIX,
  anonymousEnabled,
  constantTimeEqual,
  resolveAnonymous,
  resolveAnonymousReadOnly,
  type AnonymousIdentity,
} from "./anonymous-id.ts";

/** Neon Auth JWTs set `iss`/`aud` to the auth host origin, not `/neondb/auth`. */
export function issuerFromJwksUrl(jwksUrl: string): string {
  return new URL(jwksUrl).origin;
}

const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function remoteJwks(url: string, f: typeof fetch): ReturnType<typeof createRemoteJWKSet> {
  const cached = jwksCache.get(url);
  if (cached) return cached;
  const jwks = createRemoteJWKSet(new URL(url), { [customFetch]: jwksAcquisition(f) });
  jwksCache.set(url, jwks);
  return jwks;
}

function human(sub: unknown): AuthResult {
  return typeof sub === "string" && sub.length > 0
    ? { ok: true, userId: sub, userType: "human" }
    : INVALID;
}

/**
 * Verify a Neon Auth EdDSA bearer against the branch's JWKS. `iss` and `aud`
 * must both equal the JWKS URL origin (Neon Auth's JWT `iss`), EdDSA only —
 * every one of those is pinned by a test in auth-neon.test.ts, and weakening
 * any of them is the rollback mutation.
 *
 * A throw is classified by WHERE it came from (#452): a `JwksUnavailable` means
 * the key set never arrived and the credential is merely unchecked, while
 * anything else is a verdict on the credential.
 *
 * A branch with no `NEON_AUTH_JWKS_URL` is deliberately `INVALID` and not
 * `unverifiable`: this is a deployment that cannot verify anyone at all rather
 * than a key set that went missing, so it is not an outage to retry through —
 * and the 401 storm it logs is what makes the misconfiguration visible.
 */
export async function verifyNeonIdentity(token: string, env: AuthEnv, fetchImpl: typeof fetch): Promise<AuthResult> {
  const jwksUrl = env.NEON_AUTH_JWKS_URL;
  if (typeof jwksUrl !== "string" || jwksUrl.length === 0) return INVALID;
  try {
    const issuer = issuerFromJwksUrl(jwksUrl);
    const payload = await verifyEdDsaJwt({ token, key: remoteJwks(jwksUrl, fetchImpl), issuer, audience: issuer });
    return human(payload.sub);
  } catch (error) {
    return error instanceof JwksUnavailable ? unverifiable(error.detail) : INVALID;
  }
}

function bearerToken(request: Request): string | null {
  const header = request.headers.get("Authorization") ?? "";
  const scheme = BEARER_SCHEME.exec(header);
  if (scheme === null) return null;
  const token = header.slice(scheme[0].length).trim();
  // A scheme with nothing behind it presented no credential at all.
  return token.length > 0 ? token : null;
}

/**
 * Authenticate a /v1 request (AUTH-1 #945): only a Neon Auth JWT can produce
 * an identity (`"human"`); any legacy API-key credential is `"invalid"` — the
 * API-key mint/verify path and its backing table are deleted, so nothing here
 * ever consults them. The matrix's other classes are produced by the caller:
 * `"public"` never reaches this function, and `"anonymous"`
 * is minted downstream by `handleAnonymousV1` only for `"absent"`.
 */
export async function authenticate(
  request: Request, env: AuthEnv, fetchImpl: typeof fetch = fetch, ctx?: Pick<ExecutionContext, "waitUntil">,
): Promise<AuthResult> {
  void ctx;
  const token = bearerToken(request);
  if (token === null) return ABSENT;
  return verifyNeonIdentity(token, env, fetchImpl);
}
