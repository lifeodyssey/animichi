/**
 * @vitest-environment jsdom
 */
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchAuthStatus, useAuthStatus } from "../../../src/lib/auth/session";
import { RUNTIME_CONFIG_GLOBAL_KEY } from "../../../src/lib/runtime-config/provider";
import { DEFAULT_RUNTIME_CONFIG } from "../../../src/lib/runtime-config/runtime-config";

const getSessionMock = vi.fn();
vi.mock("@neondatabase/auth", () => ({
  createAuthClient: () => ({ getSession: getSessionMock }),
}));
vi.mock("@neondatabase/auth/vanilla", () => ({
  BetterAuthVanillaAdapter: () => () => ({}),
}));

afterEach(() => {
  vi.unstubAllGlobals();
  getSessionMock.mockReset();
});

describe("fetchAuthStatus", () => {
  it("is anonymous when Neon Auth is not configured", async () => {
    expect(await fetchAuthStatus()).toBe("anonymous");
  });

  it("is authenticated when a session is returned", async () => {
    vi.stubGlobal(RUNTIME_CONFIG_GLOBAL_KEY, { ...DEFAULT_RUNTIME_CONFIG, neonAuthBaseUrl: "https://neon.test/auth" });
    getSessionMock.mockResolvedValue({ data: { user: { id: "u1" } } });
    expect(await fetchAuthStatus()).toBe("authenticated");
  });

  it("is anonymous when there is no active session", async () => {
    vi.stubGlobal(RUNTIME_CONFIG_GLOBAL_KEY, { ...DEFAULT_RUNTIME_CONFIG, neonAuthBaseUrl: "https://neon.test/auth" });
    getSessionMock.mockResolvedValue({ data: null });
    expect(await fetchAuthStatus()).toBe("anonymous");
  });

  it("is anonymous when the auth client throws", async () => {
    vi.stubGlobal(RUNTIME_CONFIG_GLOBAL_KEY, { ...DEFAULT_RUNTIME_CONFIG, neonAuthBaseUrl: "https://neon.test/auth" });
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
