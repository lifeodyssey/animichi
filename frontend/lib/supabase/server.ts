import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

function getEnv(): { url: string; key: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Missing SUPABASE_URL or SUPABASE_ANON_KEY env vars");
  return { url, key };
}

function cookieAdapter(request: NextRequest, response: NextResponse) {
  return {
    getAll: () => request.cookies.getAll().map((c) => ({ name: c.name, value: c.value })),
    setAll: (cookies: { name: string; value: string; options?: object }[]) => {
      for (const { name, value, options } of cookies) {
        response.cookies.set(name, value, options);
      }
    },
  };
}

export function createMiddlewareClient(request: NextRequest): {
  supabase: SupabaseClient;
  response: NextResponse;
} {
  const { url, key } = getEnv();
  const response = NextResponse.next({ request });
  const supabase = createServerClient(url, key, { cookies: cookieAdapter(request, response) });
  return { supabase, response };
}

export function createRouteHandlerClient(
  request: NextRequest,
  response: NextResponse,
): SupabaseClient {
  const { url, key } = getEnv();
  return createServerClient(url, key, { cookies: cookieAdapter(request, response) });
}
