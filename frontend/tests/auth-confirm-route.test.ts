/**
 * Unit tests for GET /auth/confirm route handler.
 *
 * Tests:
 * - redirects to /login?error=expired when token_hash is missing
 * - redirects to /login?error=expired when type is missing
 * - redirects to /login?error=expired when verifyOtp returns an error
 * - redirects to /chat (default) on success
 * - redirects to custom redirect param on success
 * - sensitive params stripped from redirect URL
 *
 * Mocks: @supabase/ssr (createServerClient), next/server (NextResponse)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockVerifyOtp = vi.fn();

vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: { verifyOtp: mockVerifyOtp },
  }),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(params: Record<string, string>): Request {
  const url = new URL("http://localhost:3000/auth/confirm");
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return new Request(url.toString());
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GET /auth/confirm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_SUPABASE_URL = "http://supabase.test";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
  });

  it("redirects to /login?error=expired when token_hash is missing", async () => {
    const { GET } = await import("../app/auth/confirm/route");
    const req = makeRequest({ type: "magiclink" });

    const res = await GET(req as never);

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/login?error=expired");
  });

  it("redirects to /login?error=expired when type is missing", async () => {
    const { GET } = await import("../app/auth/confirm/route");
    const req = makeRequest({ token_hash: "abc123" });

    const res = await GET(req as never);

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/login?error=expired");
  });

  it("redirects to /login?error=expired when verifyOtp returns an error", async () => {
    mockVerifyOtp.mockResolvedValue({ error: new Error("expired") });

    const { GET } = await import("../app/auth/confirm/route");
    const req = makeRequest({ token_hash: "abc123", type: "magiclink" });

    const res = await GET(req as never);

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/login?error=expired");
  });

  it("redirects to /chat by default on success", async () => {
    mockVerifyOtp.mockResolvedValue({ error: null });

    const { GET } = await import("../app/auth/confirm/route");
    const req = makeRequest({ token_hash: "abc123", type: "magiclink" });

    const res = await GET(req as never);

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/chat");
    expect(res.headers.get("location")).not.toContain("token_hash");
  });

  it("redirects to custom redirect param on success", async () => {
    mockVerifyOtp.mockResolvedValue({ error: null });

    const { GET } = await import("../app/auth/confirm/route");
    const req = makeRequest({
      token_hash: "abc123",
      type: "magiclink",
      redirect: "/profile",
    });

    const res = await GET(req as never);

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/profile");
  });

  it("strips token_hash and type from the redirect URL", async () => {
    mockVerifyOtp.mockResolvedValue({ error: null });

    const { GET } = await import("../app/auth/confirm/route");
    const req = makeRequest({
      token_hash: "abc123",
      type: "magiclink",
      redirect: "/chat",
    });

    const res = await GET(req as never);
    const location = res.headers.get("location") ?? "";

    expect(location).not.toContain("token_hash");
    expect(location).not.toContain("type=");
  });
});
