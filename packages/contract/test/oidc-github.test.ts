import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWK } from "jose";
import {
  GITHUB_OIDC_ISSUER,
  type GitHubOidcClaims,
  type GitHubOidcPolicy,
  createGitHubOidcVerifier,
  enforceGitHubOidcAllowlist,
} from "../src/oidc-github";

const AUDIENCE = "animichi:github-actions:migrator";
const REPOSITORY = "lifeodyssey/animichi";
const TRUSTED_WORKFLOW = "lifeodyssey/animichi/.github/workflows/ci.yml@refs/heads/main";

// #1051 — reusable GitHub OIDC verifier (Migration Executor, spec
// §"Trigger authentication"). jose resolves expiry against the wall clock, so
// pin the fixture to a fixed instant (same convention as jwt.test.ts).
const FIXED_NOW = new Date("2026-02-01T00:00:00.000Z");

beforeAll(() => {
  vi.useFakeTimers({ now: FIXED_NOW, shouldAdvanceTime: true });
});

afterAll(() => {
  vi.useRealTimers();
});

/** The staging claims allowlist: ref==refs/heads/main AND environment==staging. */
function stagingPolicy(): GitHubOidcPolicy {
  return {
    issuer: GITHUB_OIDC_ISSUER,
    audience: AUDIENCE,
    repository: REPOSITORY,
    refAllow: [{ ref: "refs/heads/main", environment: "staging" }],
    subAllow: [],
    trustedWorkflowRefs: [TRUSTED_WORKFLOW],
  };
}

/** The production claims allowlist (MED-2): sub anchor OR ref+environment==production. */
function productionPolicy(): GitHubOidcPolicy {
  return {
    issuer: GITHUB_OIDC_ISSUER,
    audience: AUDIENCE,
    repository: REPOSITORY,
    refAllow: [{ ref: "refs/heads/main", environment: "production" }],
    subAllow: [`repo:${REPOSITORY}:environment:production`],
    trustedWorkflowRefs: [TRUSTED_WORKFLOW],
  };
}

type Shoulders = {
  sub?: string;
  ref?: string;
  environment?: string;
  repository?: string;
  workflow_ref?: string;
  job_workflow_ref?: string;
};

function claims(overrides: Shoulders = {}): GitHubOidcClaims {
  return {
    iss: GITHUB_OIDC_ISSUER,
    aud: AUDIENCE,
    sub: `repo:${REPOSITORY}:environment:staging`,
    ref: "refs/heads/main",
    repository: REPOSITORY,
    environment: "staging",
    workflow_ref: TRUSTED_WORKFLOW,
    job_workflow_ref: TRUSTED_WORKFLOW,
    ...overrides,
  };
}

describe("enforceGitHubOidcAllowlist (MED-2 per-environment anchoring)", () => {
  it("accepts a fully-anchored staging token", () => {
    expect(enforceGitHubOidcAllowlist(claims(), stagingPolicy())).toEqual({ ok: true });
  });

  it("rejects a main-branch token that omits the staging environment claim", () => {
    const result = enforceGitHubOidcAllowlist(claims({ environment: undefined }), stagingPolicy());
    expect(result).toEqual({ ok: false, reason: expect.any(String) });
  });

  it("rejects a staging token for a non-main ref", () => {
    const result = enforceGitHubOidcAllowlist(claims({ ref: "refs/heads/feature" }), stagingPolicy());
    expect(result).toEqual({ ok: false, reason: expect.any(String) });
  });

  it("rejects the MED-2 forbiddden OR form: ref==main OR environment==staging alone is not enough", () => {
    const refOnly = enforceGitHubOidcAllowlist(claims({ environment: undefined }), stagingPolicy());
    const envOnly = enforceGitHubOidcAllowlist(claims({ ref: "refs/heads/other" }), stagingPolicy());
    expect(refOnly).toEqual({ ok: false, reason: expect.any(String) });
    expect(envOnly).toEqual({ ok: false, reason: expect.any(String) });
  });

  it("rejects a token from another repository", () => {
    const result = enforceGitHubOidcAllowlist(claims({ repository: "attacker/other" }), stagingPolicy());
    expect(result).toEqual({ ok: false, reason: expect.any(String) });
  });

  it("rejects a token minted for another audience", () => {
    const result = enforceGitHubOidcAllowlist(claims({ aud: "some-other-audience" }), stagingPolicy());
    expect(result).toEqual({ ok: false, reason: expect.any(String) });
  });

  it("rejects a token from another issuer", () => {
    const result = enforceGitHubOidcAllowlist(claims({ iss: "https://evil.example.test" }), stagingPolicy());
    expect(result).toEqual({ ok: false, reason: expect.any(String) });
  });

  it("rejects a token whose workflow_ref is not a trusted deploy workflow", () => {
    const result = enforceGitHubOidcAllowlist(
      claims({ workflow_ref: "lifeodyssey/animichi/.github/workflows/evil.yml@refs/heads/main" }),
      stagingPolicy(),
    );
    expect(result).toEqual({ ok: false, reason: expect.any(String) });
  });

  it("rejects a token whose job_workflow_ref is not a trusted deploy workflow", () => {
    const result = enforceGitHubOidcAllowlist(
      claims({ job_workflow_ref: "lifeodyssey/animichi/.github/workflows/other.yml@refs/heads/main" }),
      stagingPolicy(),
    );
    expect(result).toEqual({ ok: false, reason: expect.any(String) });
  });

  it("production accepts the env sub anchor exactly (MED-2)", () => {
    const result = enforceGitHubOidcAllowlist(claims({ sub: `repo:${REPOSITORY}:environment:production` }), productionPolicy());
    expect(result).toEqual({ ok: true });
  });

  it("production rejects a staging sub anchor", () => {
    const result = enforceGitHubOidcAllowlist(claims(), productionPolicy());
    expect(result).toEqual({ ok: false, reason: expect.any(String) });
  });

  it("production rejects the plain repo sub anchor (not environment-scoped)", () => {
    const result = enforceGitHubOidcAllowlist(claims({ sub: `repo:${REPOSITORY}`, environment: undefined }), productionPolicy());
    expect(result).toEqual({ ok: false, reason: expect.any(String) });
  });
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
