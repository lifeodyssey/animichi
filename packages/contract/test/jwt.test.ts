import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { verifyEdDsaJwt } from "../src/jwt";

const ISSUER = "https://auth.animichi.test";
const OTHER = "https://other.animichi.test";
// jose resolves `.setExpirationTime("5m")` against the wall clock, so pin the
// fixture to a fixed instant instead of to whenever the suite happens to run.
const FIXED_NOW = new Date("2026-01-01T00:00:00.000Z");

beforeAll(() => {
  vi.useFakeTimers({ now: FIXED_NOW, shouldAdvanceTime: true });
});

afterAll(() => {
  vi.useRealTimers();
});

async function signedToken(algorithm: "EdDSA" | "ES256", issuer = ISSUER, audience = ISSUER) {
  const { privateKey, publicKey } = await generateKeyPair(algorithm);
  const jwk = { ...await exportJWK(publicKey), kid: "test-key" };
  const token = await new SignJWT({}).setProtectedHeader({ alg: algorithm, kid: jwk.kid })
    .setSubject("user-a").setIssuer(issuer).setAudience(audience).setExpirationTime("5m").sign(privateKey);
  return { key: createLocalJWKSet({ keys: [jwk] }), token };
}

describe("verifyEdDsaJwt", () => {
  it("returns the verified EdDSA payload", async () => {
    const signed = await signedToken("EdDSA");
    const payload = await verifyEdDsaJwt({ ...signed, issuer: ISSUER, audience: ISSUER });
    expect(payload.sub).toBe("user-a");
  });

  it("rejects a valid token signed with another algorithm", async () => {
    const signed = await signedToken("ES256");
    const verification = verifyEdDsaJwt({ ...signed, issuer: ISSUER, audience: ISSUER });
    await expect(verification).rejects.toThrow();
  });

  it("rejects a valid EdDSA token minted by another issuer", async () => {
    const signed = await signedToken("EdDSA", OTHER, ISSUER);
    const verification = verifyEdDsaJwt({ ...signed, issuer: ISSUER, audience: ISSUER });
    await expect(verification).rejects.toThrow();
  });

  it("rejects a valid EdDSA token minted for another audience", async () => {
    const signed = await signedToken("EdDSA", ISSUER, OTHER);
    const verification = verifyEdDsaJwt({ ...signed, issuer: ISSUER, audience: ISSUER });
    await expect(verification).rejects.toThrow();
  });
});
