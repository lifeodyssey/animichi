import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;

/**
 * Singleton browser Supabase client using @supabase/ssr.
 * Session is stored in cookies (PKCE flow), not localStorage.
 * Returns null if env vars are missing.
 */
export function createClient(): SupabaseClient | null {
  if (client) return client;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;

  try {
    client = createBrowserClient(url, key);
  } catch (err) {
    console.error("Failed to create Supabase client", err);
    return null;
  }
  return client;
}
