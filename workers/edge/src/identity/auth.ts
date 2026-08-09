/// <reference types="@cloudflare/workers-types" />

import { verifyEdDsaJwt } from "@animichi/contract/jwt";
import { createRemoteJWKSet, customFetch, decodeJwt, decodeProtectedHeader, jwtVerify } from "jose";

/**
 * Identity classes the container may be told about. `"anonymous"` (issue #274)
 * is NOT an authentication result — it is an *unauthenticated but identified*
 * caller, minted by the edge so open surfaces can still be rate-limited and
 * metered per client. `authenticate()` never returns it.
 */
export type UserType = "human" | "agent" | "anonymous";

/**
 * Why authentication produced no identity (issue #441).
 *
 * - `"absent"` — the caller presented no bearer credential at all. Only this
 *   case may fall through to the anonymous handler.
 * - `"invalid"` — a bearer credential WAS presented and failed to verify
 *   (expired, malformed, wrong issuer/audience/algorithm, unknown API key).
 *   Silently demoting it to an anonymous identity hides the expiry from the
 *   client and charges the turn to the wrong meter, so it must 401.
 *
 * A non-Bearer `Authorization` scheme is `"absent"`: this edge has never
 * accepted one, so an unrelated header must not start 401ing.
 */
export type AuthFailureReason = "absent" | "invalid";

export type AuthResult =
  | { ok: true; userId: string; userType: "human" | "agent" }
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
  SUPABASE_SERVICE_ROLE_KEY: string;
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

async function sha256Hex(raw: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function apiKeyLookupUrl(supabaseUrl: string, keyHash: string): string {
  return `${supabaseUrl}/rest/v1/api_keys?key_hash=eq.${keyHash}&revoked=eq.false&select=user_id`;
}

async function apiKeyRow(
  f: typeof fetch, env: AuthEnv, keyHash: string,
): Promise<{ user_id: string } | null> {
  const resp = await f(apiKeyLookupUrl(env.SUPABASE_URL, keyHash), { headers: serviceHeaders(env) });
  if (!resp.ok) return null;
  const rows = (await resp.json()) as { user_id: string }[];
  return rows[0] ?? null;
}

function serviceHeaders(env: AuthEnv): Record<string, string> {
  const sr = env.SUPABASE_SERVICE_ROLE_KEY;
  return { apikey: sr, Authorization: `Bearer ${sr}` };
}

function touchApiKey(f: typeof fetch, env: AuthEnv, keyHash: string): Promise<Response> {
  return f(`${env.SUPABASE_URL}/rest/v1/api_keys?key_hash=eq.${keyHash}`, {
    method: "PATCH",
    headers: { ...serviceHeaders(env), "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify({ last_used_at: new Date().toISOString() }),
  });
}

function schedule(patch: Promise<Response>, ctx?: Pick<ExecutionContext, "waitUntil">): void {
  if (ctx) ctx.waitUntil(patch); else void patch;
}

async function verifiedApiKey(
  rawKey: string, env: AuthEnv, f: typeof fetch, ctx?: Pick<ExecutionContext, "waitUntil">,
): Promise<{ ok: true; userId: string } | { ok: false }> {
  const keyHash = await sha256Hex(rawKey);
  const row = await apiKeyRow(f, env, keyHash);
  if (row === null) return { ok: false };
  schedule(touchApiKey(f, env, keyHash), ctx);
  return { ok: true, userId: row.user_id };
}

async function verifyApiKey(
  rawKey: string, env: AuthEnv, f: typeof fetch, ctx?: Pick<ExecutionContext, "waitUntil">,
): Promise<{ ok: true; userId: string } | { ok: false }> {
  try {
    return await verifiedApiKey(rawKey, env, f, ctx);
  } catch {
    return { ok: false };
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

async function agentKeyResult(
  token: string, env: AuthEnv, fetchImpl: typeof fetch, ctx?: Pick<ExecutionContext, "waitUntil">,
): Promise<AuthResult> {
  const r = await verifyApiKey(token, env, fetchImpl, ctx);
  return r.ok ? { ok: true, userId: r.userId, userType: "agent" } : INVALID;
}

/** Authenticate a /v1 request: `sk_*` -> api_keys (agent), else JWT -> issuer JWKS (human). */
export async function authenticate(
  request: Request, env: AuthEnv, fetchImpl: typeof fetch = fetch, ctx?: Pick<ExecutionContext, "waitUntil">,
): Promise<AuthResult> {
  const token = bearerToken(request);
  if (token === null) return ABSENT;
  if (token.startsWith("sk_")) return await agentKeyResult(token, env, fetchImpl, ctx);
  return verifyJwt(token, env, fetchImpl);
}
