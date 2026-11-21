import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWTPayload } from "jose";
import {
  GITHUB_OIDC_ISSUER,
  createGitHubOidcVerifier,
  type GitHubOidcVerificationResult,
} from "../src/oidc-github";
import { AUDIENCE, FIXED_NOW, REPOSITORY, TRUSTED_CD_WORKFLOW, stagingPolicy } from "./oidc-github.helpers";

// createGitHubOidcVerifier against the claims of a GitHub Actions OIDC token
// (https://docs.github.com/en/actions/reference/security/oidc). The clock is
// frozen, so `exp` and `nbf` are exact to the second.
const NOW = Math.floor(FIXED_NOW.getTime() / 1000);

beforeAll(() => {
  vi.useFakeTimers({ now: FIXED_NOW });
});

afterAll(() => {
  vi.useRealTimers();
});

/**
 * GitHub's example token, scoped to the staging deploy job. An override of
 * `undefined` leaves the claim out of the signed token.
 */
function githubOidcClaims(overrides: JWTPayload = {}): JWTPayload {
  return {
    jti: "token-fixture-jti", sub: `repo:${REPOSITORY}:environment:staging`, environment: "staging",
    aud: AUDIENCE, ref: "refs/heads/main", sha: "token-fixture-sha", repository: REPOSITORY,
    repository_owner: "lifeodyssey", run_id: "token-fixture-run", actor: "token-fixture-actor",
    event_name: "push", ref_type: "branch", workflow_ref: TRUSTED_CD_WORKFLOW,
    job_workflow_ref: TRUSTED_CD_WORKFLOW, iss: GITHUB_OIDC_ISSUER, nbf: NOW - 600, exp: NOW + 300,
    iat: NOW, ...overrides,
  };
}

async function verifySigned(claims: JWTPayload): Promise<GitHubOidcVerificationResult> {
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const jwk = { ...await exportJWK(publicKey), kid: "token-fixture-key" };
  const token = await new SignJWT(claims).setProtectedHeader({ alg: "RS256", kid: jwk.kid, typ: "JWT" })
    .sign(privateKey);
  return createGitHubOidcVerifier(stagingPolicy(), createLocalJWKSet({ keys: [jwk] })).verify(token);
}

describe("createGitHubOidcVerifier (the documented GitHub OIDC token)", () => {
  it("verifies a token carrying every standard claim of GitHub's example", async () => {
    const documented = githubOidcClaims();
    expect(await verifySigned(documented)).toEqual({ ok: true, claims: documented });
  });
});

describe("createGitHubOidcVerifier (required claims)", () => {
  it("rejects an otherwise valid token without exp at the jose layer", async () => {
    const result = await verifySigned(githubOidcClaims({ exp: undefined }));
    expect(result).toEqual({ ok: false, reason: "OIDC token failed signature, claim or expiry validation" });
  });
});
