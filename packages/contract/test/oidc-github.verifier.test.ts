import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWK } from "jose";
import { GITHUB_OIDC_ISSUER, createGitHubOidcVerifier } from "../src/oidc-github";
import {
  AUDIENCE,
  FIXED_NOW,
  REPOSITORY,
  TRUSTED_WORKFLOW,
  claims,
  productionPolicy,
  stagingPolicy,
} from "./oidc-github.helpers";

// #1051 — jose-seam verification of the GitHub OIDC verifier: signature,
// expiry, audience, and sub-anchor acceptance at the crypto layer.

beforeAll(() => {
  vi.useFakeTimers({ now: FIXED_NOW, shouldAdvanceTime: true });
});
afterAll(() => {
  vi.useRealTimers();
});

describe("createGitHubOidcVerifier (constructor-injected JWKS seam)", () => {
  it("verifies a valid RS256 token signed by the injected key", async () => {
    const { privateKey, publicKey } = await generateKeyPair("RS256", { extractable: true });
    const jwk = { ...(await exportJWK(publicKey)), kid: "oidc-test-key" } as JWK;
    const jwks = createLocalJWKSet({ keys: [jwk] });
    const verifier = createGitHubOidcVerifier(stagingPolicy(), jwks);
    const token = await new SignJWT(claims())
      .setProtectedHeader({ alg: "RS256", kid: "oidc-test-key", typ: "JWT" })
      .setIssuer(GITHUB_OIDC_ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(privateKey);
    const result = await verifier.verify(token);
    expect(result.ok).toBe(true);
  });

  it("rejects a token signed by an untrusted key", async () => {
    const trusted = await generateKeyPair("RS256", { extractable: true });
    const untrusted = await generateKeyPair("RS256", { extractable: true });
    const jwk = { ...(await exportJWK(trusted.publicKey)), kid: "oidc-trusted" } as JWK;
    const jwks = createLocalJWKSet({ keys: [jwk] });
    const verifier = createGitHubOidcVerifier(stagingPolicy(), jwks);
    const token = await new SignJWT(claims())
      .setProtectedHeader({ alg: "RS256", kid: untrusted.kid ?? "untrusted", typ: "JWT" })
      .setIssuer(GITHUB_OIDC_ISSUER)
      .setAudience(AUDIENCE)
      .setExpirationTime("5m")
      .sign(untrusted.privateKey);
    const result = await verifier.verify(token);
    expect(result.ok).toBe(false);
  });

  it("rejects an expired token", async () => {
    const { privateKey, publicKey } = await generateKeyPair("RS256", { extractable: true });
    const jwk = { ...(await exportJWK(publicKey)), kid: "oidc-test-key" } as JWK;
    const verifier = createGitHubOidcVerifier(stagingPolicy(), createLocalJWKSet({ keys: [jwk] }));
    const token = await new SignJWT(claims())
      .setProtectedHeader({ alg: "RS256", kid: "oidc-test-key", typ: "JWT" })
      .setIssuer(GITHUB_OIDC_ISSUER)
      .setAudience(AUDIENCE)
      .setExpirationTime(Math.floor(FIXED_NOW.getTime() / 1000) - 60)
      .sign(privateKey);
    const result = await verifier.verify(token);
    expect(result.ok).toBe(false);
  });

  it("rejects a token for the wrong audience at the jose layer", async () => {
    const { privateKey, publicKey } = await generateKeyPair("RS256", { extractable: true });
    const jwk = { ...(await exportJWK(publicKey)), kid: "oidc-test-key" } as JWK;
    const verifier = createGitHubOidcVerifier(stagingPolicy(), createLocalJWKSet({ keys: [jwk] }));
    const token = await new SignJWT(claims())
      .setProtectedHeader({ alg: "RS256", kid: "oidc-test-key", typ: "JWT" })
      .setIssuer(GITHUB_OIDC_ISSUER)
      .setAudience("another-audience")
      .setExpirationTime("5m")
      .sign(privateKey);
    const result = await verifier.verify(token);
    expect(result.ok).toBe(false);
  });

  it("verifies the production sub-anchored token through the jose seam too", async () => {
    const { privateKey, publicKey } = await generateKeyPair("RS256", { extractable: true });
    const jwk = { ...(await exportJWK(publicKey)), kid: "oidc-test-key" } as JWK;
    const verifier = createGitHubOidcVerifier(productionPolicy(), createLocalJWKSet({ keys: [jwk] }));
    const token = await new SignJWT(claims({ sub: `repo:${REPOSITORY}:environment:production` }))
      .setProtectedHeader({ alg: "RS256", kid: "oidc-test-key", typ: "JWT" })
      .setIssuer(GITHUB_OIDC_ISSUER)
      .setAudience(AUDIENCE)
      .setExpirationTime("5m")
      .sign(privateKey);
    const result = await verifier.verify(token);
    expect(result.ok).toBe(true);
  });
});
