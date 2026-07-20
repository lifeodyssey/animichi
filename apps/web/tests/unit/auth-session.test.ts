import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { fetchAuthToken } = vi.hoisted(() => ({ fetchAuthToken: vi.fn() }));

vi.mock("../../src/lib/auth/neonAuth", () => ({ fetchAuthToken }));

import { authHeaders, clearAuthToken, getAuthToken } from "../../src/lib/auth/authSession";

beforeEach(() => {
  clearAuthToken();
  vi.clearAllMocks();
});

afterEach(() => {
  clearAuthToken();
});

describe("getAuthToken", () => {
  it("returns undefined and no Authorization header when signed out", async () => {
    fetchAuthToken.mockResolvedValue(undefined);
    expect(await getAuthToken()).toBeUndefined();
    expect(await authHeaders()).toEqual({});
  });

  it("returns the fetched token and injects it as a Bearer header", async () => {
    fetchAuthToken.mockResolvedValue("jwt-abc");
    expect(await getAuthToken()).toBe("jwt-abc");
    expect(await authHeaders()).toEqual({ Authorization: "Bearer jwt-abc" });
  });

  it("caches the token across calls within the TTL window", async () => {
    fetchAuthToken.mockResolvedValue("jwt-cached");
    const now = 1_000_000;
    await getAuthToken(now);
    await getAuthToken(now + 1_000);
    expect(fetchAuthToken).toHaveBeenCalledTimes(1);
  });

  it("refetches once the cached token expires", async () => {
    fetchAuthToken.mockResolvedValue("jwt-1");
    const now = 1_000_000;
    await getAuthToken(now);
    fetchAuthToken.mockResolvedValue("jwt-2");
    const later = now + 15 * 60 * 1000;
    expect(await getAuthToken(later)).toBe("jwt-2");
    expect(fetchAuthToken).toHaveBeenCalledTimes(2);
  });

  it("clearAuthToken forces a refetch on the next call", async () => {
    fetchAuthToken.mockResolvedValue("jwt-1");
    await getAuthToken();
    clearAuthToken();
    fetchAuthToken.mockResolvedValue("jwt-2");
    expect(await getAuthToken()).toBe("jwt-2");
  });
});
