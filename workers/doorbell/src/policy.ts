/**
 * #1073 — the doorbell worker's OIDC policy (GitHub Actions trigger).
 *
 * One worker serves both rings: staging accepts ref == refs/heads/main AND
 * environment == staging; production accepts that ref/environment shape OR the
 * fully-qualified production sub anchor. The audience is the fixed
 * `animichi:github-actions:doorbell`, DISTINCT from the migrator audience
 * (#1051) and the staging-gate audience (#1054) so the doors never cross-accept.
 */

import { GITHUB_OIDC_ISSUER, type GitHubOidcPolicy } from "@animichi/contract/oidc-github";

/** Fixed doorbell OIDC audience (stem: `animichi:github-actions:doorbell`). */
export const DOORBELL_OIDC_AUDIENCE = "animichi:github-actions:doorbell";

/** The CI deploy pipeline at refs/heads/main may present a token. */
export const TRUSTED_WORKFLOW = "lifeodyssey/animichi/.github/workflows/ci.yml@refs/heads/main";

/** The production deploy pipeline may present a token. */
export const TRUSTED_DEPLOY_WORKFLOW = "lifeodyssey/animichi/.github/workflows/deploy.yml@refs/heads/main";

/** The reusable ring-doorbell job (called from ci.yml) may present a token. */
export const TRUSTED_RING_WORKFLOW =
  "lifeodyssey/animichi/.github/workflows/reusable-ring-doorbell.yml@refs/heads/main";

/** GitHub Actions OIDC JWKS (constructor-injected elsewhere; production source). */
export const GITHUB_OIDC_JWKS_URL = "https://token.actions.githubusercontent.com/.well-known/jwks";

/** The repository whose OIDC tokens the doorbell accepts. */
export const REPOSITORY = "lifeodyssey/animichi";

/** The doorbell's own component name (self-publish is banned). */
export const DOORBELL_COMPONENT = "doorbell";

/** Component names that must never appear in a trigger map as targets. */
export const BANNED_COMPONENTS = ["doorbell", "doorbell-staging"] as const;

/** The claims allowlist for both rings. */
export const DOORBELL_OIDC_POLICY: GitHubOidcPolicy = {
  issuer: GITHUB_OIDC_ISSUER,
  audience: DOORBELL_OIDC_AUDIENCE,
  repository: REPOSITORY,
  refAllow: [
    { ref: "refs/heads/main", environment: "staging" },
    { ref: "refs/heads/main", environment: "production" },
  ],
  subAllow: [`repo:${REPOSITORY}:environment:production`],
  trustedWorkflowRefs: [TRUSTED_WORKFLOW, TRUSTED_DEPLOY_WORKFLOW, TRUSTED_RING_WORKFLOW],
};

export function isBannedComponent(name: string): boolean {
  return BANNED_COMPONENTS.some((banned) => banned === name);
}
