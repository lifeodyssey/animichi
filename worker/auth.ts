/// <reference types="@cloudflare/workers-types" />

import { createRemoteJWKSet, customFetch, decodeJwt, decodeProtectedHeader, jwtVerify } from "jose";

export type AuthResult =
  | { ok: true; userId: string; userType: "human" | "agent" }
  | { ok: false };

export interface AuthEnv {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  NEON_AUTH_ENABLED?: string;
  NEON_AUTH_JWKS_URL?: string;
  NEON_AUTH_ISSUER?: string;
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
    : { ok: false };
}

async function verifySupabase(token: string, env: AuthEnv, f: typeof fetch): Promise<AuthResult> {
  try {
    const jwks = remoteJwks(`${env.SUPABASE_URL}/auth/v1/.well-known/jwks.json`, f);
    const { payload } = await jwtVerify(token, jwks, {
      issuer: `${env.SUPABASE_URL}/auth/v1`, audience: "authenticated", algorithms: ["ES256", "RS256"],
    });
    return human(payload.sub);
  } catch {
    return { ok: false };
  }
}

async function verifyNeon(token: string, env: AuthEnv, f: typeof fetch): Promise<AuthResult> {
  try {
    const issuer = env.NEON_AUTH_ISSUER ?? "";
    const jwks = remoteJwks(env.NEON_AUTH_JWKS_URL ?? "", f);
    const { payload } = await jwtVerify(token, jwks, { issuer, audience: issuer, algorithms: ["EdDSA"] });
    return human(payload.sub);
  } catch {
    return { ok: false };
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
    return { ok: false };
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
  if (!header.startsWith("Bearer ")) return { ok: false };
  const token = header.slice(7).trim();
  if (!token) return { ok: false };
  if (token.startsWith("sk_")) {
    const r = await verifyApiKey(token, env, fetchImpl, ctx);
    return r.ok ? { ok: true, userId: r.userId, userType: "agent" } : { ok: false };
  }
  return verifyJwt(token, env, fetchImpl);
}
