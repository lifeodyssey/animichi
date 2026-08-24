/**
 * #1054 — the staging-gate OIDC policy (CI channel of the staging gate).
 *
 * Migration Executor (spec §"Trigger authentication", OIDC phase 2): the CI
 * channel of the staging gate accepts the pipeline's GitHub OIDC identity. It
 * is the SAME module (@animichi/contract/oidc-github) the migrator uses — one
 * implementation, two doors — but with a DISTINCT audience so a token minted
 * for the migrator (#1051, animichi:github-actions:migrator) can never be
 * replayed against the staging gate, and vice versa.
 *
 * Per-environment-anchored claims allowlist (MED-2): staging accepts only
 * ref == refs/heads/main AND environment == staging, minted by the trusted
 * CI deploy workflow. The static browser gate token (STAGING_GATE_TOKEN,
 * cookie/header) keeps working unchanged as the human channel; this policy is
 * only the CI OIDC channel the exchange endpoint verifies.
 */

import { GITHUB_OIDC_ISSUER, type GitHubOidcPolicy } from "@animichi/contract/oidc-github";

/**
 * Fixed staging-gate OIDC audience (stem: `animichi:github-actions:staging-gate`).
 * CI requests it via ACTIONS_ID_TOKEN_REQUEST_URL?audience=... and GitHub
 * mints the token with this aud. DISTINCT from the migrator audience (#1051)
 * so the two doors never cross-accept (spec: "DISTINCT per-service audiences").
 */
export const STAGING_GATE_OIDC_AUDIENCE = "animichi:github-actions:staging-gate";

/**
 * The deploy workflow that may present a token to the staging gate's CI
 * channel: the repository's CI deploy pipeline at refs/heads/main (same
 * trusted workflow ref the migrator uses).
 */
export const STAGING_GATE_TRUSTED_WORKFLOWS = [
  "lifeodyssey/animichi/.github/workflows/cd.yml@refs/heads/main",
  "lifeodyssey/animichi/.github/workflows/reusable-promote-release-phase.yml@refs/heads/main",
] as const;

/** GitHub Actions OIDC JWKS (constructor-injected elsewhere; production source). */
export const GITHUB_OIDC_JWKS_URL =
  "https://token.actions.githubusercontent.com/.well-known/jwks";

/** The staging-gate claims allowlist (staging-anchored, MED-2). */
export const STAGING_GATE_OIDC_POLICY: GitHubOidcPolicy = {
  issuer: GITHUB_OIDC_ISSUER,
  audience: STAGING_GATE_OIDC_AUDIENCE,
  repository: "lifeodyssey/animichi",
  refAllow: [{ ref: "refs/heads/main", environment: "staging" }],
  subAllow: [],
  trustedWorkflowRefs: [...STAGING_GATE_TRUSTED_WORKFLOWS],
};
