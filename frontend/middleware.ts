import { type NextRequest, NextResponse } from "next/server";
import { createMiddlewareClient } from "./lib/supabase/server";
import {
  unauthorizedResponse,
  validateApiKey,
  validateJwt,
} from "./lib/auth/api-auth";

const PUBLIC_API_PATTERNS = ["/v1/search/preview", "/v1/bangumi/popular"];
const PROTECTED_PAGES = ["/chat", "/settings"];

function isPublicApiRoute(p: string): boolean {
  return PUBLIC_API_PATTERNS.includes(p) || /^\/v1\/bangumi\/[^/]+\/guide$/.test(p);
}

async function handleApiAuth(request: NextRequest) {
  const authHeader = request.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return unauthorizedResponse();

  const token = authHeader.slice(7).trim();
  if (!token) return unauthorizedResponse();

  const auth = token.startsWith("sk_")
    ? await validateApiKey(token)
    : await validateJwt(token);

  if (!auth.ok) return unauthorizedResponse();

  const headers = new Headers(request.headers);
  headers.delete("Authorization");
  headers.set("X-User-Id", auth.userId);
  headers.set("X-User-Type", auth.userType);
  return NextResponse.next({ request: { headers } });
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname.startsWith("/v1/")) {
    if (isPublicApiRoute(pathname)) return NextResponse.next();
    return handleApiAuth(request);
  }

  const { supabase, response } = createMiddlewareClient(request);
  const { data: { user } } = await supabase.auth.getUser();

  if (PROTECTED_PAGES.some((p) => pathname.startsWith(p)) && !user) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("redirect", pathname + request.nextUrl.search);
    return NextResponse.redirect(loginUrl);
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon\\.ico|icon\\.svg|images/|leaflet/|.*\\.(?:svg|png|jpg|jpeg|webp|ico|woff2?)$).*)",
  ],
};
