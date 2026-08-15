/**
 * #1051 — the migrator worker's OIDC policy (GitHub Actions trigger).
 *
 * Per-environment-anchored claims allowlist (MED-2, issue #1051 amendment):
 * staging accepts only ref == refs/heads/main AND environment == staging.
 * The audience is a fixed project-specific value, DISTINCT from the
 * staging-gate verifier audience (#1054) so the two doors never cross-accept.
 *
 * This card wires STAGING. The production migrator path is #1055 (separate
 * worker/DSN, sub-anchored allowlist) and deliberately does not live here.
 */

import { GITHUB_OIDC_ISSUER, type GitHubOidcPolicy } from "@animichi/contract/oidc-github";

/**
 * Fixed migrator OIDC audience (stem: `animichi:github-actions:migrator`).
 * CI requests it via ACTIONS_ID_TOKEN_REQUEST_URL?audience=... and GitHub
 * mints the token with this aud. It must never collide with the staging-gate
 * verifier's audience (#1054).
 */
export const MIGRATOR_OIDC_AUDIENCE = "animichi:github-actions:migrator";

/**
 * The deploy workflow that may present a token to the staging migrator:
 * the repository's CI deploy pipeline at refs/heads/main.
 */
export const TRUSTED_WORKFLOW = "lifeodyssey/animichi/.github/workflows/ci.yml@refs/heads/main";

/** GitHub Actions OIDC JWKS (constructor-injected elsewhere; production source). */
export const GITHUB_OIDC_JWKS_URL = "https://token.actions.githubusercontent.com/.well-known/jwks";

/** The staging claims allowlist. */
export const STAGING_OIDC_POLICY: GitHubOidcPolicy = {
  issuer: GITHUB_OIDC_ISSUER,
  audience: MIGRATOR_OIDC_AUDIENCE,
  repository: "lifeodyssey/animichi",
  refAllow: [{ ref: "refs/heads/main", environment: "staging" }],
  subAllow: [],
  trustedWorkflowRefs: [TRUSTED_WORKFLOW],
};
