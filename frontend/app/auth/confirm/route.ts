import { type NextRequest, NextResponse } from "next/server";
import { createRouteHandlerClient } from "../../../lib/supabase/server";
import { safeRedirect } from "../../../lib/safe-redirect";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const token_hash = searchParams.get("token_hash");
  const type = searchParams.get("type");
  const redirect = safeRedirect(searchParams.get("redirect"));

  if (!token_hash || !type) {
    return NextResponse.redirect(new URL("/login?error=expired", request.url));
  }

  const redirectUrl = new URL(redirect, request.url);
  redirectUrl.searchParams.delete("token_hash");
  redirectUrl.searchParams.delete("type");

  const response = NextResponse.redirect(redirectUrl);
  const supabase = createRouteHandlerClient(request, response);
  const { error } = await supabase.auth.verifyOtp({ type, token_hash });

  if (error) {
    return NextResponse.redirect(new URL("/login?error=expired", request.url));
  }

  return response;
}
