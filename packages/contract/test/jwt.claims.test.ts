import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWTPayload } from "jose";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { verifyEdDsaJwt } from "../src/jwt";

// verifyEdDsaJwt against the claims of a Neon Auth access token
// (https://neon.com/docs/auth/guides/plugins/jwt). The clock is frozen, so the
// documented 15-minute `exp` stays ahead of it.
const ORIGIN = "https://token-fixture-auth.animichi.test";
const FIXED_NOW = new Date("2026-04-01T00:00:00.000Z");
const NOW = Math.floor(FIXED_NOW.getTime() / 1000);

beforeAll(() => {
  vi.useFakeTimers({ now: FIXED_NOW });
});

afterAll(() => {
  vi.useRealTimers();
});

/** The claims Neon documents for its access token. An override of `undefined` leaves the claim out. */
function neonAuthClaims(overrides: JWTPayload = {}): JWTPayload {
  return {
    iat: NOW, sub: "token-fixture-user", exp: NOW + 900, iss: ORIGIN, aud: ORIGIN,
    role: "authenticated", ...overrides,
  };
}

async function verifySigned(claims: JWTPayload): Promise<JWTPayload> {
  const { privateKey, publicKey } = await generateKeyPair("EdDSA");
  const jwk = { ...await exportJWK(publicKey), kid: "token-fixture-key" };
  const token = await new SignJWT(claims).setProtectedHeader({ alg: "EdDSA", kid: jwk.kid }).sign(privateKey);
  return verifyEdDsaJwt({ token, key: createLocalJWKSet({ keys: [jwk] }), issuer: ORIGIN, audience: ORIGIN });
}

describe("verifyEdDsaJwt (the documented Neon Auth token)", () => {
  it("verifies a token carrying every claim of Neon's example payload", async () => {
    const documented = neonAuthClaims({
      name: "Token Fixture", email: "token-fixture@animichi.test", emailVerified: false, image: null,
      createdAt: "2026-03-01T00:00:00.000Z", updatedAt: "2026-03-01T00:00:00.000Z", banned: false,
      banReason: null, banExpires: null, id: "token-fixture-user",
    });
    await expect(verifySigned(documented)).resolves.toEqual(documented);
  });
});

describe("verifyEdDsaJwt (required claims)", () => {
  it.each(["exp", "sub"])("rejects an otherwise valid token without %s", async (claim) => {
    const verification = verifySigned(neonAuthClaims({ [claim]: undefined }));
    await expect(verification).rejects.toMatchObject({ claim, reason: "missing" });
  });

  it("verifies a token without iat, because no age bound applies", async () => {
    const payload = await verifySigned(neonAuthClaims({ iat: undefined }));
    expect(payload.sub).toBe("token-fixture-user");
  });
});
