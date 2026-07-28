/// <reference types="@cloudflare/workers-types" />

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

const ABSENT: AuthResult = { ok: false, reason: "absent" };
const INVALID: AuthResult = { ok: false, reason: "invalid" };

export interface AuthEnv {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  NEON_AUTH_ENABLED?: string;
  NEON_AUTH_JWKS_URL?: string;
  NEON_AUTH_ISSUER?: string;
}

export interface AnonymousEnv {
  ANON_ACCESS_ENABLED?: string;
  ANON_ID_SECRET?: string;
}

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

async function verifySupabase(token: string, env: AuthEnv, f: typeof fetch): Promise<AuthResult> {
  try {
    const jwks = remoteJwks(`${env.SUPABASE_URL}/auth/v1/.well-known/jwks.json`, f);
    const { payload } = await jwtVerify(token, jwks, {
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
    const { payload } = await jwtVerify(token, jwks, { issuer, audience: issuer, algorithms: ["EdDSA"] });
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

async function verifyApiKey(
  rawKey: string,
  env: AuthEnv,
  f: typeof fetch,
  ctx?: Pick<ExecutionContext, "waitUntil">,
): Promise<{ ok: true; userId: string } | { ok: false }> {
  try {
    const keyHash = await sha256Hex(rawKey);
    const sr = env.SUPABASE_SERVICE_ROLE_KEY;
    const resp = await f(
      `${env.SUPABASE_URL}/rest/v1/api_keys?key_hash=eq.${keyHash}&revoked=eq.false&select=user_id`,
      { headers: { apikey: sr, Authorization: `Bearer ${sr}` } },
    );
    if (!resp.ok) return { ok: false };
    const rows = (await resp.json()) as { user_id: string }[];
    const [row] = rows;
    if (!row) return { ok: false };
    const patch = f(`${env.SUPABASE_URL}/rest/v1/api_keys?key_hash=eq.${keyHash}`, {
      method: "PATCH",
      headers: { apikey: sr, Authorization: `Bearer ${sr}`, "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify({ last_used_at: new Date().toISOString() }),
    });
    if (ctx) ctx.waitUntil(patch); else void patch;
    return { ok: true, userId: row.user_id };
  } catch {
    return { ok: false };
  }
}

/** Authenticate a /v1 request: `sk_*` -> api_keys (agent), else JWT -> issuer JWKS (human). */
export async function authenticate(
  request: Request,
  env: AuthEnv,
  fetchImpl: typeof fetch = fetch,
  ctx?: Pick<ExecutionContext, "waitUntil">,
): Promise<AuthResult> {
  const header = request.headers.get("Authorization") ?? "";
  // Header values arrive already trimmed, so a `Bearer` with an empty token is
  // indistinguishable from a bare `Bearer` scheme and lands in ABSENT — there
  // is no separate empty-token branch to reach.
  if (!header.startsWith("Bearer ")) return ABSENT;
  const token = header.slice(7).trim();
  if (token.startsWith("sk_")) {
    const r = await verifyApiKey(token, env, fetchImpl, ctx);
    return r.ok ? { ok: true, userId: r.userId, userType: "agent" } : INVALID;
  }
  return verifyJwt(token, env, fetchImpl);
}

// ── Anonymous identity (issue #274 / S1.8) ─────────────────────────────────
//
// Mechanism: a worker-signed, opaque, HttpOnly cookie. The edge mints a random
// id and an HMAC tag over it, so the id is stable per browser (survives IP
// changes and CGNAT, unlike an IP-derived hash) and cannot be forged into an
// arbitrary namespace or made to collide with another visitor's counters. No
// PII is derived or stored. Anonymous access is opt-in: without both
// ANON_ACCESS_ENABLED and ANON_ID_SECRET the edge keeps its existing 401.

const ANON_COOKIE = "aid";
const ANON_COOKIE_MAX_AGE_SECONDS = 31_536_000;
const ANON_ID_PATTERN = /^[0-9a-f]{32}$/;

/** Container-visible prefix of every anonymous `X-User-Id`. */
export const ANON_ID_PREFIX = "anon_";

export interface AnonymousIdentity {
  readonly userId: string;
  /** Set only when this request minted a new identity. */
  readonly setCookie: string | null;
}

export function anonymousEnabled(env: AnonymousEnv): boolean {
  return (
    env.ANON_ACCESS_ENABLED === "true" &&
    typeof env.ANON_ID_SECRET === "string" &&
    env.ANON_ID_SECRET.length > 0
  );
}

function readCookie(request: Request, name: string): string | null {
  for (const part of (request.headers.get("Cookie") ?? "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name && rest.length > 0) return rest.join("=");
  }
  return null;
}

async function hmacHex(secret: string, message: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return Array.from(new Uint8Array(signature)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let i = 0; i < left.length; i += 1) difference |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return difference === 0;
}

async function verifyAnonymousToken(token: string, secret: string): Promise<string | null> {
  const [id, signature] = token.split(".");
  if (id === undefined || signature === undefined || !ANON_ID_PATTERN.test(id)) return null;
  return constantTimeEqual(signature, await hmacHex(secret, id)) ? id : null;
}

function anonymousCookie(token: string): string {
  return `${ANON_COOKIE}=${token}; Path=/; Max-Age=${ANON_COOKIE_MAX_AGE_SECONDS}; HttpOnly; Secure; SameSite=Lax`;
}

async function mintAnonymousIdentity(secret: string): Promise<AnonymousIdentity> {
  const id = crypto.randomUUID().replaceAll("-", "");
  return {
    userId: `${ANON_ID_PREFIX}${id}`,
    setCookie: anonymousCookie(`${id}.${await hmacHex(secret, id)}`),
  };
}

/**
 * Resolve (or mint) this browser's anonymous identity. A brand-new visitor
 * with zero history is issued one immediately — there is no minimum-history
 * threshold and no first-request penalty. Returns null when anonymous access
 * is not enabled, which leaves the caller on the authenticated path.
 */
export async function resolveAnonymous(
  request: Request,
  env: AnonymousEnv,
): Promise<AnonymousIdentity | null> {
  const secret = env.ANON_ID_SECRET;
  if (!anonymousEnabled(env) || secret === undefined) return null;
  const cookie = readCookie(request, ANON_COOKIE);
  const verified = cookie === null ? null : await verifyAnonymousToken(cookie, secret);
  if (verified === null) return mintAnonymousIdentity(secret);
  return { userId: `${ANON_ID_PREFIX}${verified}`, setCookie: null };
}
