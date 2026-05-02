import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Create a Supabase server client for Next.js middleware.
 * Reads/writes session cookies on the request/response pair.
 */
export function createMiddlewareClient(request: NextRequest): {
  supabase: SupabaseClient;
  response: NextResponse;
} {
  const response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () =>
          request.cookies.getAll().map((c) => ({
            name: c.name,
            value: c.value,
          })),
        setAll: (cookies) => {
          for (const { name, value, options } of cookies) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  return { supabase, response };
}

/**
 * Create a Supabase server client for Route Handlers.
 * Reads cookies from the request, writes to the response.
 */
export function createRouteHandlerClient(
  request: NextRequest,
  response: NextResponse,
): SupabaseClient {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () =>
          request.cookies.getAll().map((c) => ({
            name: c.name,
            value: c.value,
          })),
        setAll: (cookies) => {
          for (const { name, value, options } of cookies) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );
}
