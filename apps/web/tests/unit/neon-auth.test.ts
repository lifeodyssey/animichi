import { afterEach, describe, expect, it, vi } from "vitest";

const { magicLink } = vi.hoisted(() => ({ magicLink: vi.fn() }));

vi.mock("better-auth/client", () => ({
  createAuthClient: () => ({ signIn: { magicLink } }),
}));
vi.mock("better-auth/client/plugins", () => ({ magicLinkClient: () => ({}) }));

import { isNeonAuthConfigured, sendMagicLink } from "../../src/lib/auth/neonAuth";

const request = { email: "fan@example.com", callbackURL: "https://app.test/auth/callback" };

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
