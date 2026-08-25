/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { createAuthClient, getSession } = vi.hoisted(() => ({
  createAuthClient: vi.fn(),
  getSession: vi.fn(),
}));

vi.mock("@neondatabase/auth", () => ({ createAuthClient }));
vi.mock("@neondatabase/auth/vanilla", () => ({ BetterAuthVanillaAdapter: vi.fn(() => vi.fn()) }));

import {
  fetchAuthToken, isNeonAuthConfigured, redeemAuthToken, resetAuthSessionSource, sendMagicLink,
} from "../../src/lib/auth/neon-auth";
import { resetNeonAuthClient } from "../../src/lib/auth/neon-auth-client";
import { RUNTIME_CONFIG_GLOBAL_KEY } from "../../src/lib/runtime-config/provider";
import { DEFAULT_RUNTIME_CONFIG } from "../../src/lib/runtime-config/runtime-config";

const request = { email: "fan@example.com", callbackURL: "https://app.test/auth/callback" };

beforeEach(() => {
  vi.stubGlobal(RUNTIME_CONFIG_GLOBAL_KEY, DEFAULT_RUNTIME_CONFIG);
  createAuthClient.mockReturnValue({ signIn: { magicLink: vi.fn() }, getSession });
});

afterEach(() => {
  resetAuthSessionSource();
  resetNeonAuthClient();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function configure(): void {
  vi.stubGlobal(RUNTIME_CONFIG_GLOBAL_KEY, {
    ...DEFAULT_RUNTIME_CONFIG,
    neonAuthBaseUrl: "https://auth.test/neondb/auth",
  });
}

/** Rebind after the environment flag changes: the source is resolved once and cached. */
function renderOnServer(): void {
  vi.stubEnv("SSR", true);
  resetAuthSessionSource();
}

describe("neon auth configuration", () => {
  it("is unconfigured when the runtime config carries no base URL", () => {
    expect(isNeonAuthConfigured()).toBe(false);
  });

  it("is configured once the runtime config names a base URL", () => {
    configure();
    expect(isNeonAuthConfigured()).toBe(true);
  });
});

describe("browser binding", () => {
  it("reads a token through the Neon Auth SDK client", async () => {
    configure();
    getSession.mockResolvedValue({ data: { session: { token: "aaa.bbb.ccc" } }, error: null });
    expect(await fetchAuthToken()).toBe("aaa.bbb.ccc");
  });

  it("resolves the bound source once and reuses it for later reads", async () => {
    configure();
    getSession.mockResolvedValue({ data: { session: { token: "aaa.bbb.ccc" } }, error: null });
    await fetchAuthToken();
    await fetchAuthToken();
    expect(createAuthClient).toHaveBeenCalledTimes(1);
  });
});

// The SDK mints a BroadcastChannel tab id with `crypto.randomUUID()` at module scope, which
// workerd refuses outside an I/O context. SSR therefore binds to the signed-out session, and
// a Worker never had a cookie jar to read a real one from anyway.
describe("server binding", () => {
  it("never reaches the SDK for a token, even with Neon Auth configured", async () => {
    configure();
    renderOnServer();
    expect(await fetchAuthToken()).toBeUndefined();
    expect(createAuthClient).not.toHaveBeenCalled();
  });

  it("never reaches the SDK for a magic link, even with Neon Auth configured", async () => {
    configure();
    renderOnServer();
    expect(await sendMagicLink(request)).toBe("not_configured");
    expect(createAuthClient).not.toHaveBeenCalled();
  });

  it("redeems no session token", async () => {
    configure();
    renderOnServer();
    expect(await redeemAuthToken()).toEqual({ error: { message: "" } });
  });
});
