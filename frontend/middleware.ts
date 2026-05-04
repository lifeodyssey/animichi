import { type NextRequest, NextResponse } from "next/server";
import { createMiddlewareClient } from "./lib/supabase/server";

/**
 * Public API routes that skip auth — anyone can call these.
 */
const PUBLIC_API_PATTERNS = [
  "/v1/search/preview",
  "/v1/bangumi/popular",
];

function isPublicApiRoute(pathname: string): boolean {
  if (PUBLIC_API_PATTERNS.includes(pathname)) return true;
  // /v1/bangumi/{id}/guide
  return /^\/v1\/bangumi\/[^/]+\/guide$/.test(pathname);
}

/**
 * Protected page routes — require session cookie.
 */
const PROTECTED_PAGES = ["/chat", "/settings"];

function isProtectedPage(pathname: string): boolean {
  return PROTECTED_PAGES.some((p) => pathname.startsWith(p));
}

/**
 * Validate an sk_ API key by hashing and looking up in api_keys table.
 * Uses Supabase PostgREST with service_role key.
 */
async function validateApiKey(
  rawKey: string,
): Promise<{ ok: boolean; userId?: string }> {
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
    if (!rows.length) return { ok: false };

    // Best-effort update last_used_at (fire-and-forget)
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

    return { ok: true, userId: rows[0].user_id };
  } catch {
    return { ok: false };
  }
}

/**
 * Validate a JWT by calling Supabase auth.getUser() via the server client.
 */
async function validateJwt(
  token: string,
): Promise<{ ok: boolean; userId?: string }> {
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
    return { ok: true, userId: user.id };
  } catch {
    return { ok: false };
  }
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // ── API routes (/v1/*) ──
  if (pathname.startsWith("/v1/")) {
    // Public API routes pass through
    if (isPublicApiRoute(pathname)) {
      return NextResponse.next();
    }

    // Protected API routes require Bearer token
    const authHeader = request.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) {
      return NextResponse.json(
        { error: { code: "unauthorized", message: "Valid credentials required." } },
        { status: 401 },
      );
    }

    const token = authHeader.slice(7).trim();
    if (!token) {
      return NextResponse.json(
        { error: { code: "unauthorized", message: "Valid credentials required." } },
        { status: 401 },
      );
    }

    // Validate: sk_ key or JWT
    const auth = token.startsWith("sk_")
      ? await validateApiKey(token)
      : await validateJwt(token);

    if (!auth.ok) {
      return NextResponse.json(
        { error: { code: "unauthorized", message: "Valid credentials required." } },
        { status: 401 },
      );
    }

    // Inject identity headers, strip raw token
    const headers = new Headers(request.headers);
    headers.delete("Authorization");
    headers.set("X-User-Id", auth.userId!);
    headers.set("X-User-Type", token.startsWith("sk_") ? "agent" : "human");
    return NextResponse.next({ request: { headers } });
  }

  // ── Page routes ──
  // Create Supabase server client to refresh session cookie
  const { supabase, response } = createMiddlewareClient(request);

  // getUser() refreshes the session cookie if needed
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Protected pages require a valid session
  if (isProtectedPage(pathname) && !user) {
    const loginUrl = new URL("/login", request.url);
    const redirect = pathname + request.nextUrl.search;
    loginUrl.searchParams.set("redirect", redirect);
    return NextResponse.redirect(loginUrl);
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Match all paths except:
     * - _next/static (static files)
     * - _next/image (image optimization)
     * - Static assets (svg, png, jpg, etc.)
     */
    "/((?!_next/static|_next/image|favicon\\.ico|icon\\.svg|images/|leaflet/|.*\\.(?:svg|png|jpg|jpeg|webp|ico|woff2?)$).*)",
  ],
};
