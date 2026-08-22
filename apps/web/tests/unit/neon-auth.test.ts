/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { createAuthClient, jwtClient, magicLink, token } = vi.hoisted(() => ({
  createAuthClient: vi.fn(),
  jwtClient: vi.fn(() => ({ id: "jwt" })),
  magicLink: vi.fn(),
  token: vi.fn(),
}));

vi.mock("better-auth/client", () => ({
  createAuthClient,
}));
vi.mock("better-auth/client/plugins", () => ({ jwtClient, magicLinkClient: () => ({}) }));

import { fetchAuthToken, isNeonAuthConfigured, sendMagicLink } from "../../src/lib/auth/neon-auth";
import { RUNTIME_CONFIG_GLOBAL_KEY } from "../../src/lib/runtime-config/provider";
import { DEFAULT_RUNTIME_CONFIG } from "../../src/lib/runtime-config/runtime-config";

const request = { email: "fan@example.com", callbackURL: "https://app.test/auth/callback" };

beforeEach(() => {
  // Hermetic baseline: neutralize any ambient Neon Auth base URL (e.g. a dev
  // machine's injected runtime config) so "unset" cases don't false-red. The
  // value now lives in the versioned runtime config global (#1013 AC1).
  vi.stubGlobal(RUNTIME_CONFIG_GLOBAL_KEY, DEFAULT_RUNTIME_CONFIG);
  createAuthClient.mockReturnValue({ signIn: { magicLink }, token });
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
    // An explicitly-empty value is rejected at load by the runtime-config
    // schema (fail-closed, covered by the loader's tests); an ABSENT field is
    // the documented "auth not configured" shape.
    vi.stubGlobal(RUNTIME_CONFIG_GLOBAL_KEY, DEFAULT_RUNTIME_CONFIG);
    expect(isNeonAuthConfigured()).toBe(false);
  });

  it("calls the official client's signIn.magicLink and returns sent on success", async () => {
    configure();
    magicLink.mockResolvedValue({ data: {}, error: null });
    expect(await sendMagicLink(request)).toBe("sent");
    expect(magicLink).toHaveBeenCalledWith(request);
  });

  it("returns error when the client responds with an error envelope", async () => {
    configure();
    magicLink.mockResolvedValue({ data: null, error: { message: "boom" } });
    expect(await sendMagicLink(request)).toBe("error");
  });

  it("returns error when the client rejects", async () => {
    configure();
    magicLink.mockRejectedValue(new Error("network"));
    expect(await sendMagicLink(request)).toBe("error");
  });
});

describe("fetchAuthToken", () => {
  it("returns undefined when Neon Auth is not configured", async () => {
    expect(await fetchAuthToken()).toBeUndefined();
  });

  it("returns the JWT from a signed-in session's /token response", async () => {
    configure();
    token.mockResolvedValue({ data: { token: "jwt-xyz" }, error: null });
    expect(await fetchAuthToken()).toBe("jwt-xyz");
  });

  it("uses jwtClient with cross-origin credentials and the Neon session verifier handshake", async () => {
    configure();
    token.mockResolvedValue({ data: { token: "jwt-xyz" }, error: null });
    await fetchAuthToken();
    expect(jwtClient).toHaveBeenCalledTimes(1);
    const config = createAuthClient.mock.calls[0]?.[0] as {
      baseURL: string;
      fetchOptions: { credentials: RequestCredentials };
    };
    expect(config.baseURL).toBe("https://auth.test/neondb/auth");
    expect(config.fetchOptions.credentials).toBe("include");
  });

  it("forwards neon_auth_session_verifier from the callback URL onto the token request", async () => {
    configure();
    token.mockResolvedValue({ data: { token: "jwt-xyz" }, error: null });
    window.history.replaceState({}, "", "/auth/callback?neon_auth_session_verifier=ml-abc");
    await fetchAuthToken();
    const options = createAuthClient.mock.calls[0]?.[0] as {
      fetchOptions: { onRequest: (ctx: { url: string }) => { url: URL } | undefined };
    };
    const attached = options.fetchOptions.onRequest({ url: "https://auth.test/neondb/auth/token" });
    expect(attached?.url.searchParams.get("neon_auth_session_verifier")).toBe("ml-abc");
  });

  it("returns undefined when jwtClient reports no session", async () => {
    configure();
    token.mockResolvedValue({ data: null, error: { status: 401 } });
    expect(await fetchAuthToken()).toBeUndefined();
  });

  it("returns undefined when jwtClient throws", async () => {
    configure();
    token.mockRejectedValue(new Error("network"));
    expect(await fetchAuthToken()).toBeUndefined();
  });
});
