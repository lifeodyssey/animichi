import { type JWK } from "jose";
import {
  GITHUB_OIDC_ISSUER,
  type GitHubOidcClaims,
  type GitHubOidcPolicy,
} from "../src/oidc-github";

export const AUDIENCE = "animichi:github-actions:migrator";
export const REPOSITORY = "lifeodyssey/animichi";
export const TRUSTED_WORKFLOW = "lifeodyssey/animichi/.github/workflows/ci.yml@refs/heads/main";

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
    trustedWorkflowRefs: [TRUSTED_WORKFLOW],
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
    trustedWorkflowRefs: [TRUSTED_WORKFLOW],
  };
}

export type Shoulders = {
  sub?: string;
  ref?: string;
  environment?: string;
  repository?: string;
  workflow_ref?: string;
  job_workflow_ref?: string;
};

export function claims(overrides: Shoulders = {}): GitHubOidcClaims {
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

export type { JWK };
