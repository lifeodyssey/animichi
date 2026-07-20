import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { server } from "../msw/node";

const { magicLink } = vi.hoisted(() => ({ magicLink: vi.fn() }));

vi.mock("better-auth/client", () => ({
  createAuthClient: () => ({ signIn: { magicLink } }),
}));
vi.mock("better-auth/client/plugins", () => ({ magicLinkClient: () => ({}) }));

import { fetchAuthToken, isNeonAuthConfigured, sendMagicLink } from "../../src/lib/auth/neonAuth";

const request = { email: "fan@example.com", callbackURL: "https://app.test/auth/callback" };

beforeEach(() => {
  // Hermetic baseline: neutralize any ambient VITE_NEON_AUTH_BASE_URL (e.g. a dev
  // machine's apps/web/.env.local) so "unset" cases don't false-red. Passing
  // undefined deletes the key from import.meta.env (vitest vi.stubEnv contract).
  vi.stubEnv("VITE_NEON_AUTH_BASE_URL", undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

function configure(base = "https://auth.test/neondb/auth"): void {
  vi.stubEnv("VITE_NEON_AUTH_BASE_URL", base);
}

describe("neon auth magic link", () => {
  it("reports not configured when the base URL is unset", async () => {
    expect(isNeonAuthConfigured()).toBe(false);
    expect(await sendMagicLink(request)).toBe("not_configured");
    expect(magicLink).not.toHaveBeenCalled();
  });

  it("treats an empty base URL as unconfigured", () => {
    vi.stubEnv("VITE_NEON_AUTH_BASE_URL", "");
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
    server.use(
      http.get("https://auth.test/neondb/auth/token", () => HttpResponse.json({ token: "jwt-xyz" })),
    );
    expect(await fetchAuthToken()).toBe("jwt-xyz");
  });

  it("sends the request with credentials included, so the auth cookie rides along", async () => {
    configure();
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ token: "jwt-xyz" }), { status: 200 }),
    );
    await fetchAuthToken();
    expect(spy).toHaveBeenCalledWith(
      "https://auth.test/neondb/auth/token",
      expect.objectContaining({ credentials: "include" }),
    );
  });

  it("returns undefined when there is no session (401)", async () => {
    configure();
    server.use(
      http.get("https://auth.test/neondb/auth/token", () => new HttpResponse(null, { status: 401 })),
    );
    expect(await fetchAuthToken()).toBeUndefined();
  });

  it("returns undefined when the response body doesn't match the expected shape", async () => {
    configure();
    server.use(
      http.get("https://auth.test/neondb/auth/token", () => HttpResponse.json({ nope: true })),
    );
    expect(await fetchAuthToken()).toBeUndefined();
  });

  it("returns undefined when the fetch throws", async () => {
    configure();
    server.use(
      http.get("https://auth.test/neondb/auth/token", () => HttpResponse.error()),
    );
    expect(await fetchAuthToken()).toBeUndefined();
  });
});
