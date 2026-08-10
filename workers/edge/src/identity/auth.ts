/// <reference types="@cloudflare/workers-types" />

import {
  type IdentityClass,
  type IdentityClassPolicy,
  type IdentityPolicy,
} from "@animichi/contract/identity";
import { verifyEdDsaJwt } from "@animichi/contract/jwt";
import { createRemoteJWKSet, customFetch, decodeJwt, decodeProtectedHeader, jwtVerify } from "jose";

/**
 * Identity classes the container may be told about. `"anonymous"` (issue #274)
 * is NOT an authentication result — it is an *unauthenticated but identified*
 * caller, minted by the edge so open surfaces can still be rate-limited and
 * metered per client. `authenticate()` never returns it.
 */
export type UserType = "human" | "anonymous";

/**
 * The explicit identity matrix (AUTH-1 #945): how a /v1 request is classified
 * and the numeric configuration each class is governed by.
 *
 *  - `"public"`       — allowlisted read routes (PUBLIC_V1 in
 *                       gateway/routing-policy.ts): no credential, no limiter,
 *                       no quota, no budget.
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

export {
  identityClassSchema,
  identityClassPolicySchema,
  identityPolicySchema,
  identityRateLimitSchema,
  DEFAULT_IDENTITY_POLICY,
} from "@animichi/contract/identity";

/**
 * Why authentication produced no identity (issue #441).
 *
 * - `"absent"` — the caller presented no bearer credential at all. Only this
 *   case may fall through to the anonymous handler.
 * - `"invalid"` — a bearer credential WAS presented and failed to verify
 *   (expired, malformed, wrong issuer/audience/algorithm). Silently demoting
 *   it to an anonymous identity hides the expiry from the client and charges
 *   the turn to the wrong meter, so it must 401.
 *
 * A non-Bearer `Authorization` scheme is `"absent"`: this edge has never
 * accepted one, so an unrelated header must not start 401ing.
 */
export type AuthFailureReason = "absent" | "invalid";

export type AuthResult =
  | { ok: true; userId: string; userType: "human" }
  | { ok: false; reason: AuthFailureReason };

// Frozen because both are module-level singletons shared by every request on
// the isolate: a stray mutation would poison the verdict for all of them.
const ABSENT: AuthResult = Object.freeze({ ok: false, reason: "absent" });
const INVALID: AuthResult = Object.freeze({ ok: false, reason: "invalid" });

/**
 * The `Bearer` auth-scheme, matched per RFC 7235 §2.1: the scheme token is
 * case-insensitive, and the separator may be any run of SP/HTAB. Anything
 * else — `Basic`, `Bearerish`, a bare scheme — is not our credential format.
 */
export const BEARER_SCHEME = /^bearer[ \t]+/i;

export interface AuthEnv {
  SUPABASE_URL: string;
  NEON_AUTH_ENABLED?: string;
  NEON_AUTH_JWKS_URL?: string;
  NEON_AUTH_ISSUER?: string;
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

const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function remoteJwks(url: string, f: typeof fetch): ReturnType<typeof createRemoteJWKSet> {
  const cached = jwksCache.get(url);
  if (cached) return cached;
  const jwks = createRemoteJWKSet(new URL(url), { [customFetch]: f });
  jwksCache.set(url, jwks);
  return jwks;
}

function human(sub: unknown): AuthResult {
  return typeof sub === "string" && sub.length > 0
    ? { ok: true, userId: sub, userType: "human" }
    : INVALID;
}

function supabaseJwks(env: AuthEnv, f: typeof fetch): ReturnType<typeof createRemoteJWKSet> {
  return remoteJwks(`${env.SUPABASE_URL}/auth/v1/.well-known/jwks.json`, f);
}

async function verifySupabase(token: string, env: AuthEnv, f: typeof fetch): Promise<AuthResult> {
  try {
    const { payload } = await jwtVerify(token, supabaseJwks(env, f), {
      issuer: `${env.SUPABASE_URL}/auth/v1`, audience: "authenticated", algorithms: ["ES256", "RS256"],
    });
    return human(payload.sub);
  } catch {
    return INVALID;
  }
}

async function verifyNeon(token: string, env: AuthEnv, f: typeof fetch): Promise<AuthResult> {
  try {
    const issuer = env.NEON_AUTH_ISSUER ?? "";
    const jwks = remoteJwks(env.NEON_AUTH_JWKS_URL ?? "", f);
    const payload = await verifyEdDsaJwt({ token, key: jwks, issuer, audience: issuer });
    return human(payload.sub);
  } catch {
    return INVALID;
  }
}

function neonEnabled(env: AuthEnv): boolean {
  return env.NEON_AUTH_ENABLED === "true"
    && typeof env.NEON_AUTH_JWKS_URL === "string" && env.NEON_AUTH_JWKS_URL.length > 0
    && typeof env.NEON_AUTH_ISSUER === "string" && env.NEON_AUTH_ISSUER.length > 0;
}

async function verifyJwt(token: string, env: AuthEnv, f: typeof fetch): Promise<AuthResult> {
  try {
    const header = decodeProtectedHeader(token);
    const payload = decodeJwt(token);
    const useNeon = neonEnabled(env) && (header.alg === "EdDSA" || payload.iss === env.NEON_AUTH_ISSUER);
    return useNeon ? await verifyNeon(token, env, f) : await verifySupabase(token, env, f);
  } catch {
    return INVALID;
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
 * Authenticate a /v1 request (AUTH-1 #945): only a JWT can produce an
 * identity (`"human"`); any legacy API-key credential is `"invalid"` — the
 * API-key mint/verify path and its backing table are deleted, so nothing here
 * ever consults them. The matrix's other classes are produced by the caller:
 * `"public"` never reaches this function (routing-policy), and `"anonymous"`
 * is minted downstream by `handleAnonymousV1` only for `"absent"`.
 */
export async function authenticate(
  request: Request, env: AuthEnv, fetchImpl: typeof fetch = fetch, ctx?: Pick<ExecutionContext, "waitUntil">,
): Promise<AuthResult> {
  void ctx;
  const token = bearerToken(request);
  if (token === null) return ABSENT;
  return verifyJwt(token, env, fetchImpl);
}
