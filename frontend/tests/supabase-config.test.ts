import { it, expect, vi } from "vitest";

it("createClient returns null when public env vars are missing", async () => {
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // Reset the module so it re-evaluates with missing env vars
  vi.resetModules();

  const { createClient } = await import("../lib/supabase/browser");

  expect(createClient()).toBe(null);
});
