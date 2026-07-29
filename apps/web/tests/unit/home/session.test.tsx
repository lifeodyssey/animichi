/**
 * @vitest-environment jsdom
 */
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchAuthStatus, useAuthStatus } from "../../../src/lib/auth/session";

const getSessionMock = vi.fn();
vi.mock("better-auth/client", () => ({
  createAuthClient: () => ({ getSession: getSessionMock }),
}));

afterEach(() => {
  vi.unstubAllEnvs();
  getSessionMock.mockReset();
});

describe("fetchAuthStatus", () => {
  it("is anonymous when Neon Auth is not configured", async () => {
    expect(await fetchAuthStatus()).toBe("anonymous");
  });

  it("is authenticated when a session is returned", async () => {
    vi.stubEnv("VITE_NEON_AUTH_BASE_URL", "https://neon.test/auth");
    getSessionMock.mockResolvedValue({ data: { user: { id: "u1" } } });
    expect(await fetchAuthStatus()).toBe("authenticated");
  });

  it("is anonymous when there is no active session", async () => {
    vi.stubEnv("VITE_NEON_AUTH_BASE_URL", "https://neon.test/auth");
    getSessionMock.mockResolvedValue({ data: null });
    expect(await fetchAuthStatus()).toBe("anonymous");
  });

  it("is anonymous when the auth client throws", async () => {
    vi.stubEnv("VITE_NEON_AUTH_BASE_URL", "https://neon.test/auth");
    getSessionMock.mockRejectedValue(new Error("network"));
    expect(await fetchAuthStatus()).toBe("anonymous");
  });
});

describe("useAuthStatus", () => {
  it("starts pending and resolves via the injected fetcher", async () => {
    const { result } = renderHook(() => useAuthStatus(() => Promise.resolve("authenticated")));
    expect(result.current).toBe("pending");
    await waitFor(() => { expect(result.current).toBe("authenticated"); });
  });
});
