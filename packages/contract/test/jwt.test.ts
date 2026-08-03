import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { describe, expect, it } from "vitest";
import { verifyEdDsaJwt } from "../src/jwt";

const ISSUER = "https://auth.animichi.test";

async function signedToken(algorithm: "EdDSA" | "ES256") {
  const { privateKey, publicKey } = await generateKeyPair(algorithm);
  const jwk = { ...await exportJWK(publicKey), kid: "test-key" };
  const token = await new SignJWT({}).setProtectedHeader({ alg: algorithm, kid: jwk.kid })
    .setSubject("user-a").setIssuer(ISSUER).setAudience(ISSUER).setExpirationTime("5m").sign(privateKey);
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
});
