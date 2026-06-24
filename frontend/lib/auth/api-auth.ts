import { NextResponse } from "next/server";

export type AuthResult =
  | { ok: true; userId: string; userType: "human" | "agent" }
  | { ok: false };

export function unauthorizedResponse() {
  return NextResponse.json(
    { error: { code: "unauthorized", message: "Valid credentials required." } },
    { status: 401 },
  );
}

export async function validateApiKey(rawKey: string): Promise<AuthResult> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) return { ok: false };

  try {
    const data = new TextEncoder().encode(rawKey);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const keyHash = Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    const resp = await fetch(
      `${supabaseUrl}/rest/v1/api_keys?key_hash=eq.${keyHash}&revoked=eq.false&select=user_id`,
      {
        headers: {
          apikey: serviceRoleKey,
          Authorization: `Bearer ${serviceRoleKey}`,
        },
      },
    );
    if (!resp.ok) return { ok: false };
    const rows = (await resp.json()) as { user_id: string }[];
    const row = rows[0];
    if (!row) return { ok: false };

    void fetch(`${supabaseUrl}/rest/v1/api_keys?key_hash=eq.${keyHash}`, {
      method: "PATCH",
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({ last_used_at: new Date().toISOString() }),
    });

    return { ok: true, userId: row.user_id, userType: "agent" };
  } catch {
    return { ok: false };
  }
}

export async function validateJwt(token: string): Promise<AuthResult> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey) return { ok: false };

  try {
    const resp = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: anonKey,
      },
    });
    if (!resp.ok) return { ok: false };
    const user = (await resp.json()) as { id: string };
    return { ok: true, userId: user.id, userType: "human" };
  } catch {
    return { ok: false };
  }
}
