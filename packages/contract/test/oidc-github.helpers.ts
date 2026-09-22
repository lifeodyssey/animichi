import { type JWK } from "jose";
import { expect } from "vitest";
import {
  GITHUB_OIDC_ISSUER,
  type GitHubOidcAllowlistResult,
  type GitHubOidcClaims,
  type GitHubOidcPolicy,
} from "../src/oidc-github";

export const AUDIENCE = "animichi:github-actions:migrator";
export const REPOSITORY = "lifeodyssey/animichi";
export const TRUSTED_CD_WORKFLOW = "lifeodyssey/animichi/.github/workflows/cd.yml@refs/heads/main";

// #1051 — reusable GitHub OIDC verifier (Migration Executor, spec
// §"Trigger authentication"). jose resolves expiry against the wall clock, so
// pin the fixture to a fixed instant (same convention as jwt.test.ts).
export const FIXED_NOW = new Date("2026-02-01T00:00:00.000Z");

/** The staging claims allowlist: ref==refs/heads/main AND environment==staging. */
export function stagingPolicy(): GitHubOidcPolicy {
  return {
    issuer: GITHUB_OIDC_ISSUER,
    audience: AUDIENCE,
    repository: REPOSITORY,
    refAllow: [{ ref: "refs/heads/main", environment: "staging" }],
    subAllow: [],
    trustedWorkflowRefs: [TRUSTED_CD_WORKFLOW],
  };
}

/** The production claims allowlist (MED-2): sub anchor OR ref+environment==production. */
export function productionPolicy(): GitHubOidcPolicy {
  return {
    issuer: GITHUB_OIDC_ISSUER,
    audience: AUDIENCE,
    repository: REPOSITORY,
    refAllow: [{ ref: "refs/heads/main", environment: "production" }],
    subAllow: [`repo:${REPOSITORY}:environment:production`],
    trustedWorkflowRefs: [TRUSTED_CD_WORKFLOW],
  };
}

export interface Shoulders {
  sub?: string;
  ref?: string;
  environment?: string;
  repository?: string;
  workflow_ref?: string;
  job_workflow_ref?: string;
}

export function claims(overrides: Shoulders = {}): GitHubOidcClaims {
  return {
    iss: GITHUB_OIDC_ISSUER,
    aud: AUDIENCE,
    sub: `repo:${REPOSITORY}:environment:staging`,
    ref: "refs/heads/main",
    repository: REPOSITORY,
    environment: "staging",
    workflow_ref: TRUSTED_CD_WORKFLOW,
    ...overrides,
  };
}

/**
 * Assert the allowlist rejected the token, and hand its reason back.
 *
 * `expect.any(String)` is an `any`-typed value and `no-unsafe-assignment`
 * refuses it inside an expected object; asserting the discriminated union is
 * the type-safe form and a stricter one, because the reason must be non-empty
 * where `expect.any(String)` also accepted `""`.
 */
export function rejectionReason(result: GitHubOidcAllowlistResult): string {
  if (result.ok) throw new Error("expected the allowlist to reject the token");
  expect(result.reason.trim()).not.toBe("");
  return result.reason;
}

export type { JWK };
