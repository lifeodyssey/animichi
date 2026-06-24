/**
 * Tests for validateApiKey and validateJwt in lib/auth/api-auth.ts.
 * These are the security-critical functions that validate API credentials.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock next/server before importing api-auth
vi.mock("next/server", () => ({
  NextResponse: { json: vi.fn() },
}));

// Mock global fetch — must be done before module import
const origFetch = globalThis.fetch;
const mockFetch = vi.fn();

describe("validateJwt", () => {
  beforeEach(() => {
    vi.resetModules();
    globalThis.fetch = mockFetch;
    mockFetch.mockReset();
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
  });

  afterEach(() => {
    globalThis.fetch = origFetch;
  });

  it("returns ok with userId for valid JWT", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ id: "user-123" }),
    });

    const { validateJwt } = await import("../lib/auth/api-auth");
    const result = await validateJwt("valid-jwt-token");

    expect(result).toEqual({ ok: true, userId: "user-123", userType: "human" });
    expect(mockFetch).toHaveBeenCalledWith(
      "https://test.supabase.co/auth/v1/user",
      expect.objectContaining({
        headers: {
          Authorization: "Bearer valid-jwt-token",
          apikey: "test-anon-key",
        },
      }),
    );
  });

  it("returns ok: false for expired JWT", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false });

    const { validateJwt } = await import("../lib/auth/api-auth");
    const result = await validateJwt("expired-token");

    expect(result).toEqual({ ok: false });
  });

  it("returns ok: false when fetch throws", async () => {
    mockFetch.mockRejectedValueOnce(new Error("network error"));

    const { validateJwt } = await import("../lib/auth/api-auth");
    const result = await validateJwt("any-token");

    expect(result).toEqual({ ok: false });
  });

  it("returns ok: false when env vars missing", async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;

    const { validateJwt } = await import("../lib/auth/api-auth");
    const result = await validateJwt("any-token");

    expect(result).toEqual({ ok: false });
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe("validateApiKey", () => {
  beforeEach(() => {
    vi.resetModules();
    globalThis.fetch = mockFetch;
    mockFetch.mockReset();
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
  });

  afterEach(() => {
    globalThis.fetch = origFetch;
  });

  it("returns ok with userId for valid sk_ key", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve([{ user_id: "agent-456" }]),
    });
    // Second fetch: fire-and-forget last_used_at update
    mockFetch.mockResolvedValueOnce({ ok: true });

    const { validateApiKey } = await import("../lib/auth/api-auth");
    const result = await validateApiKey("sk_test_abc123");

    expect(result).toEqual({ ok: true, userId: "agent-456", userType: "agent" });
    expect(mockFetch.mock.calls[0]?.[0]).toContain("/rest/v1/api_keys?key_hash=eq.");
  });

  it("returns ok: false for revoked key (empty result)", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve([]),
    });

    const { validateApiKey } = await import("../lib/auth/api-auth");
    const result = await validateApiKey("sk_revoked_key");

    expect(result).toEqual({ ok: false });
  });

  it("returns ok: false when PostgREST returns error", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false });

    const { validateApiKey } = await import("../lib/auth/api-auth");
    const result = await validateApiKey("sk_bad_key");

    expect(result).toEqual({ ok: false });
  });
});

// Need to import afterEach
import { afterEach } from "vitest";
