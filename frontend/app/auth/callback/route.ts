import { type NextRequest, NextResponse } from "next/server";
import { createRouteHandlerClient } from "../../../lib/supabase/server";
import { safeRedirect } from "../../../lib/safe-redirect";

/**
 * Auth callback Route Handler — handles both PKCE code exchange
 * and token_hash verification.
 *
 * PKCE flow (local Supabase default):
 *   GoTrue verify → redirect to site_url/auth/callback?code=xxx
 *   → exchangeCodeForSession(code) → set cookie → redirect
 *
 * Token hash flow (production / custom email templates):
 *   Email link → /auth/callback?token_hash=xxx&type=email
 *   → verifyOtp({ token_hash, type }) → set cookie → redirect
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const token_hash = searchParams.get("token_hash");
  const type = searchParams.get("type");
  const redirect = safeRedirect(searchParams.get("redirect") ?? searchParams.get("next"));

  const redirectUrl = new URL(redirect, request.url);

  // Build response first so cookie adapter can write to it
  const response = NextResponse.redirect(redirectUrl);
  const supabase = createRouteHandlerClient(request, response);

  if (code) {
    // PKCE flow: exchange code for session
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      return NextResponse.redirect(new URL("/login?error=expired", request.url));
    }
    return response;
  }

  if (token_hash && type) {
    // Token hash flow: verify OTP directly
    const { error } = await supabase.auth.verifyOtp({ type, token_hash });
    if (error) {
      return NextResponse.redirect(new URL("/login?error=expired", request.url));
    }
    return response;
  }

  return NextResponse.redirect(new URL("/login?error=expired", request.url));
}
