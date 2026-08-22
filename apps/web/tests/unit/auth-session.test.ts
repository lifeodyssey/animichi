import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { fetchAuthToken, redeemAuthToken } = vi.hoisted(() => ({
  fetchAuthToken: vi.fn(),
  redeemAuthToken: vi.fn(),
}));

vi.mock("../../src/lib/auth/neon-auth", () => ({ fetchAuthToken, redeemAuthToken }));

import {
  authHeaders, clearAuthToken, establishAuthSession, getAuthToken,
} from "../../src/lib/auth/auth-session";

const NOW = 2_000_000_000_000;
const REFRESH_MARGIN_MS = 60_000;

function jwt(expiryMs: number): string {
  const payload = btoa(JSON.stringify({ exp: expiryMs / 1_000 }))
    .replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
  return `header.${payload}.signature`;
}

beforeEach(() => {
  clearAuthToken();
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  clearAuthToken();
  vi.useRealTimers();
});

describe("getAuthToken", () => {
  it("returns undefined and no Authorization header when signed out", async () => {
    fetchAuthToken.mockResolvedValue(undefined);
    expect(await getAuthToken()).toBeUndefined();
    expect(await authHeaders()).toEqual({});
  });

  it("returns the fetched token and injects it as a Bearer header", async () => {
    const token = jwt(NOW + 5 * 60_000);
    fetchAuthToken.mockResolvedValue(token);
    expect(await getAuthToken()).toBe(token);
    expect(await authHeaders()).toEqual({ Authorization: `Bearer ${token}` });
  });

  it("clearAuthToken forces a refetch on the next call", async () => {
    fetchAuthToken.mockResolvedValue(jwt(NOW + 5 * 60_000));
    await getAuthToken();
    clearAuthToken();
    const second = jwt(NOW + 10 * 60_000);
    fetchAuthToken.mockResolvedValue(second);
    expect(await getAuthToken()).toBe(second);
  });
});

describe("getAuthToken cache expiry", () => {
  it("refreshes a short token at its exp boundary minus the safety margin", async () => {
    const expiry = NOW + 5 * 60_000;
    const first = jwt(expiry);
    const second = jwt(expiry + 10 * 60_000);
    fetchAuthToken.mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    expect(await getAuthToken()).toBe(first);
    vi.setSystemTime(expiry - REFRESH_MARGIN_MS - 1);
    expect(await getAuthToken()).toBe(first);
    expect(fetchAuthToken).toHaveBeenCalledTimes(1);
    vi.setSystemTime(expiry - REFRESH_MARGIN_MS);
    expect(await getAuthToken()).toBe(second);
  });

  it("keeps a long token beyond the old fixed TTL and refreshes at its own boundary", async () => {
    const expiry = NOW + 30 * 60_000;
    const first = jwt(expiry);
    const second = jwt(expiry + 30 * 60_000);
    fetchAuthToken.mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    expect(await getAuthToken()).toBe(first);
    vi.setSystemTime(NOW + 20 * 60_000);
    expect(await getAuthToken()).toBe(first);
    vi.setSystemTime(expiry - REFRESH_MARGIN_MS);
    expect(await getAuthToken()).toBe(second);
    expect(fetchAuthToken).toHaveBeenCalledTimes(2);
  });

  it("does not cache a token whose payload cannot be decoded", async () => {
    fetchAuthToken.mockResolvedValue("not-a-jwt");
    expect(await getAuthToken()).toBe("not-a-jwt");
    expect(await getAuthToken()).toBe("not-a-jwt");
    expect(fetchAuthToken).toHaveBeenCalledTimes(2);
  });

  it("does not cache a token without a numeric exp claim", async () => {
    const payload = btoa(JSON.stringify({ exp: "later" }));
    fetchAuthToken.mockResolvedValue(`header.${payload}.signature`);
    await getAuthToken();
    await getAuthToken();
    expect(fetchAuthToken).toHaveBeenCalledTimes(2);
  });
});

describe("establishAuthSession", () => {
  it("returns the token and seeds the in-memory cache", async () => {
    const token = jwt(NOW + 5 * 60_000);
    redeemAuthToken.mockResolvedValue({ token });
    expect(await establishAuthSession()).toBe(token);
    expect(await getAuthToken()).toBe(token);
    expect(fetchAuthToken).not.toHaveBeenCalled();
  });

  it("throws the SDK error.message when redeem fails", async () => {
    redeemAuthToken.mockResolvedValue({ error: { message: "INVALID_TOKEN" } });
    await expect(establishAuthSession()).rejects.toThrow("INVALID_TOKEN");
  });
});
