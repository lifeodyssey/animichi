/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { createAuthClient, BetterAuthVanillaAdapter, magicLink, getSession } = vi.hoisted(() => ({
  createAuthClient: vi.fn(),
  BetterAuthVanillaAdapter: vi.fn(() => vi.fn()),
  magicLink: vi.fn(),
  getSession: vi.fn(),
}));

vi.mock("@neondatabase/auth", () => ({ createAuthClient }));
vi.mock("@neondatabase/auth/vanilla", () => ({ BetterAuthVanillaAdapter }));

import {
  fetchAuthToken, isNeonAuthConfigured, redeemAuthToken, sendMagicLink,
} from "../../src/lib/auth/neon-auth";
import { RUNTIME_CONFIG_GLOBAL_KEY } from "../../src/lib/runtime-config/provider";
import { DEFAULT_RUNTIME_CONFIG } from "../../src/lib/runtime-config/runtime-config";

const request = { email: "fan@example.com", callbackURL: "https://app.test/auth/callback" };

beforeEach(() => {
  // Hermetic baseline: neutralize any ambient Neon Auth base URL (e.g. a dev
  // machine's injected runtime config) so "unset" cases don't false-red. The
  // value now lives in the versioned runtime config global (#1013 AC1).
  vi.stubGlobal(RUNTIME_CONFIG_GLOBAL_KEY, DEFAULT_RUNTIME_CONFIG);
  createAuthClient.mockReturnValue({ signIn: { magicLink }, getSession });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function configure(base = "https://auth.test/neondb/auth"): void {
  vi.stubGlobal(RUNTIME_CONFIG_GLOBAL_KEY, { ...DEFAULT_RUNTIME_CONFIG, neonAuthBaseUrl: base });
}

describe("neon auth magic link", () => {
  it("reports not configured when the base URL is unset", async () => {
    expect(isNeonAuthConfigured()).toBe(false);
    expect(await sendMagicLink(request)).toBe("not_configured");
    expect(magicLink).not.toHaveBeenCalled();
  });

  it("treats an unset base URL as unconfigured", () => {
    vi.stubGlobal(RUNTIME_CONFIG_GLOBAL_KEY, DEFAULT_RUNTIME_CONFIG);
    expect(isNeonAuthConfigured()).toBe(false);
  });

  it("calls the official client's signIn.magicLink and returns sent on success", async () => {
    configure();
    magicLink.mockResolvedValue({ data: {}, error: null });
    expect(await sendMagicLink(request)).toBe("sent");
    expect(magicLink).toHaveBeenCalledWith(request);
  });

  it("returns the SDK error.message from an error envelope", async () => {
    configure();
    magicLink.mockResolvedValue({ data: null, error: { message: "boom" } });
    expect(await sendMagicLink(request)).toEqual({ error: "boom" });
  });

  it("returns the thrown error.message when the client rejects", async () => {
    configure();
    magicLink.mockRejectedValue(new Error("network"));
    expect(await sendMagicLink(request)).toEqual({ error: "network" });
  });
});

describe("fetchAuthToken", () => {
  it("returns undefined when Neon Auth is not configured", async () => {
    expect(await fetchAuthToken()).toBeUndefined();
  });

  it("returns the JWT the SDK injects into getSession's session.token", async () => {
    configure();
    getSession.mockResolvedValue({ data: { session: { token: "jwt-xyz" } }, error: null });
    expect(await fetchAuthToken()).toBe("jwt-xyz");
  });

  it("builds the Neon Auth client with cross-origin credentials included", async () => {
    configure();
    getSession.mockResolvedValue({ data: { session: { token: "jwt-xyz" } }, error: null });
    await fetchAuthToken();
    expect(BetterAuthVanillaAdapter).toHaveBeenCalledWith({
      fetchOptions: { credentials: "include" },
    });
    expect(createAuthClient.mock.calls[0]?.[0]).toBe("https://auth.test/neondb/auth");
  });

  it("returns undefined when getSession reports no session", async () => {
    configure();
    getSession.mockResolvedValue({ data: null, error: null });
    expect(await fetchAuthToken()).toBeUndefined();
  });

  it("returns undefined when getSession throws", async () => {
    configure();
    getSession.mockRejectedValue(new Error("network"));
    expect(await fetchAuthToken()).toBeUndefined();
  });
});

describe("redeemAuthToken", () => {
  it("keeps the SDK error.message from a failed getSession envelope", async () => {
    configure();
    getSession.mockResolvedValue({ data: null, error: { message: "Unauthorized" } });
    expect(await redeemAuthToken()).toEqual({ error: { message: "Unauthorized" } });
  });

  it("keeps the thrown error.message when getSession rejects", async () => {
    configure();
    getSession.mockRejectedValue(new Error("network"));
    expect(await redeemAuthToken()).toEqual({ error: { message: "network" } });
  });
});
