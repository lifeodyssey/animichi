/// <reference types="@cloudflare/workers-types" />

export type AuthResult =
  | { ok: true; userId: string; userType: "human" | "agent" }
  | { ok: false };

export interface AuthEnv {
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
}

async function verifyJwt(token: string, env: AuthEnv, f: typeof fetch): Promise<{ ok: true; userId: string } | { ok: false }> {
  try {
    const resp = await f(`${env.SUPABASE_URL}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${token}`, apikey: env.SUPABASE_ANON_KEY },
    });
    if (!resp.ok) return { ok: false };
    const user = (await resp.json()) as { id?: string };
    return user.id ? { ok: true, userId: user.id } : { ok: false };
  } catch {
    return { ok: false };
  }
}

async function sha256Hex(raw: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function verifyApiKey(rawKey: string, env: AuthEnv, f: typeof fetch): Promise<{ ok: true; userId: string } | { ok: false }> {
  try {
    const keyHash = await sha256Hex(rawKey);
    const sr = env.SUPABASE_SERVICE_ROLE_KEY;
    const resp = await f(
      `${env.SUPABASE_URL}/rest/v1/api_keys?key_hash=eq.${keyHash}&revoked=eq.false&select=user_id`,
      { headers: { apikey: sr, Authorization: `Bearer ${sr}` } },
    );
    if (!resp.ok) return { ok: false };
    const rows = (await resp.json()) as { user_id: string }[];
    if (!rows.length) return { ok: false };
    void f(`${env.SUPABASE_URL}/rest/v1/api_keys?key_hash=eq.${keyHash}`, {
      method: "PATCH",
      headers: { apikey: sr, Authorization: `Bearer ${sr}`, "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify({ last_used_at: new Date().toISOString() }),
    });
    return { ok: true, userId: rows[0].user_id };
  } catch {
    return { ok: false };
  }
}

/** Authenticate a /v1 request: `sk_*` -> api_keys (agent), else JWT -> /auth/v1/user (human). */
export async function authenticate(request: Request, env: AuthEnv, fetchImpl: typeof fetch = fetch): Promise<AuthResult> {
  const header = request.headers.get("Authorization") ?? "";
  if (!header.startsWith("Bearer ")) return { ok: false };
  const token = header.slice(7).trim();
  if (!token) return { ok: false };
  if (token.startsWith("sk_")) {
    const r = await verifyApiKey(token, env, fetchImpl);
    return r.ok ? { ok: true, userId: r.userId, userType: "agent" } : { ok: false };
  }
  const r = await verifyJwt(token, env, fetchImpl);
  return r.ok ? { ok: true, userId: r.userId, userType: "human" } : { ok: false };
}
