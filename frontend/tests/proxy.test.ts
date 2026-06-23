import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";

// Mock @supabase/ssr before importing proxy
vi.mock("@supabase/ssr", () => ({
  createServerClient: vi.fn(() => ({
    auth: {
      getUser: vi.fn(),
    },
  })),
}));

// Mock next/server
const mockRedirect = vi.fn();
const mockNext = vi.fn();
const mockJson = vi.fn();

vi.mock("next/server", () => ({
  NextResponse: {
    redirect: (...args: unknown[]) => {
      mockRedirect(...args);
      return { cookies: { set: vi.fn() }, headers: { set: vi.fn(), delete: vi.fn() } };
    },
    next: (...args: unknown[]) => {
      mockNext(...args);
      return { cookies: { set: vi.fn() }, headers: { set: vi.fn(), delete: vi.fn() } };
    },
    json: (...args: unknown[]) => {
      mockJson(...args);
      return { status: 401 };
    },
  },
}));

function makeRequest(path: string, headers: Record<string, string> = {}): { nextUrl: { pathname: string; search: string }; url: string; headers: { get: (k: string) => string | null }; cookies: { getAll: () => { name: string; value: string }[] } } {
  return {
    nextUrl: { pathname: path, search: "" },
    url: `http://localhost:3000${path}`,
    headers: { get: (k: string) => headers[k] ?? null },
    cookies: { getAll: () => [] },
  };
}

// Retrieve the mocked createServerClient as a plain Mock. Accessing it through
// this helper (rather than destructuring the typed export) avoids the upstream
// @deprecated JSDoc on the get/set/remove cookie overload leaking into tests.
async function getMockedCreateServerClient(): Promise<Mock> {
  const ssr = (await import("@supabase/ssr")) as unknown as {
    createServerClient: Mock;
  };
  return ssr.createServerClient;
}

describe("proxy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";
  });

  it("passes through public pages without auth check", async () => {
    const createServerClient = await getMockedCreateServerClient();
    const mockGetUser = vi.fn().mockResolvedValue({ data: { user: null } });
    createServerClient.mockReturnValue({
      auth: { getUser: mockGetUser },
    });

    const { proxy } = await import("../proxy");
    await proxy(makeRequest("/") as never);

    expect(mockRedirect).not.toHaveBeenCalled();
  });

  it("redirects /chat to /login when no session", async () => {
    vi.resetModules();
    const createServerClient = await getMockedCreateServerClient();
    const mockGetUser = vi.fn().mockResolvedValue({ data: { user: null } });
    createServerClient.mockReturnValue({
      auth: { getUser: mockGetUser },
    });

    const { proxy } = await import("../proxy");
    await proxy(makeRequest("/chat") as never);

    expect(mockRedirect).toHaveBeenCalled();
    const redirectUrl = mockRedirect.mock.calls[0]?.[0] as URL;
    expect(redirectUrl.pathname).toBe("/login");
    expect(redirectUrl.searchParams.get("redirect")).toBe("/chat");
  });

  it("passes through /chat when session exists", async () => {
    vi.resetModules();
    const createServerClient = await getMockedCreateServerClient();
    const mockGetUser = vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } } });
    createServerClient.mockReturnValue({
      auth: { getUser: mockGetUser },
    });

    const { proxy } = await import("../proxy");
    await proxy(makeRequest("/chat") as never);

    expect(mockRedirect).not.toHaveBeenCalled();
    expect(mockNext).toHaveBeenCalled();
  });

  it("allows public API routes without auth", async () => {
    vi.resetModules();
    const { proxy } = await import("../proxy");
    await proxy(makeRequest("/v1/bangumi/popular") as never);

    expect(mockNext).toHaveBeenCalled();
    expect(mockJson).not.toHaveBeenCalled();
  });

  it("returns 401 for protected API routes without Bearer token", async () => {
    vi.resetModules();
    const { proxy } = await import("../proxy");
    await proxy(makeRequest("/v1/runtime") as never);

    expect(mockJson).toHaveBeenCalledWith(
      { error: { code: "unauthorized", message: "Valid credentials required." } },
      { status: 401 },
    );
  });
});
