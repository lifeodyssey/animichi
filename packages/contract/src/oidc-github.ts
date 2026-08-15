/**
 * @animichi/contract/oidc-github — reusable GitHub Actions OIDC verifier.
 *
 * Migration Executor (spec §"Trigger authentication"): CI jobs present the
 * built-in GitHub OIDC token (jose, RS256 against GitHub's JWKS); the
 * migrator verifies it and then enforces a per-environment-anchored claims
 * allowlist. The JWKS source is constructor-injected so tests sign with a
 * local key pair while production points at
 * https://token.actions.githubusercontent.com/.well-known/jwks.
 *
 * MED-2 (issue #1051 amendment) forbids the OR form (`ref==main OR
 * environment==production`). Each target environment is enforced by a
 * dedicated worker with its own anchored rule:
 *   - staging: ref == refs/heads/main AND environment == staging
 *   - production: sub == repo:{repo}:environment:production, OR
 *     ref == refs/heads/main AND environment == production
 * The disjunction in the production policy is fine — the two branches are
 * independently fully-anchored shapes, not a weak `ref OR environment`.
 * Prior art: the edge worker's verifier (workers/edge/src/identity/auth.ts)
 * and @animichi/contract/jwt (EdDSA envelope).
 */

import { jwtVerify, type JWTPayload, type JWTVerifyGetKey } from "jose";

/** GitHub Actions OIDC issuer (fixed by GitHub; not forgeable). */
export const GITHUB_OIDC_ISSUER = "https://token.actions.githubusercontent.com";

/** Claims GitHub's OIDC token carries for an environment-scoped deploy job. */
export interface GitHubOidcClaims {
  iss?: string;
  aud?: string | string[];
  sub?: string;
  ref?: string;
  repository?: string;
  workflow_ref?: string;
  job_workflow_ref?: string;
  environment?: string;
}

/**
 * The per-environment claims allowlist. `refAllow` is the ref-and-environment
 * anchored shape (staging); `subAllow` is the fully-qualified sub anchor
 * (production). `trustedWorkflowRefs` restricts workflow_ref/job_workflow_ref
 * to the deploy workflows that may present a token.
 */
export interface GitHubOidcPolicy {
  issuer: string;
  audience: string;
  repository: string;
  refAllow: { ref: string; environment?: string }[];
  subAllow: string[];
  trustedWorkflowRefs: string[];
}

export type GitHubOidcAllowlistResult =
  | { ok: true }
  | { ok: false; reason: string };

export type GitHubOidcVerificationResult =
  | { ok: true; claims: GitHubOidcClaims }
  | { ok: false; reason: string };

function isNonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function audienceMatches(policy: GitHubOidcPolicy, audience: GitHubOidcClaims["aud"]): boolean {
  if (typeof audience === "string") return audience === policy.audience;
  return Array.isArray(audience) ? audience.some((entry) => entry === policy.audience) : false;
}

function trustedWorkflow(claim: unknown, policy: GitHubOidcPolicy): boolean {
  return typeof claim === "string" && policy.trustedWorkflowRefs.includes(claim);
}

function refAnchored(claims: GitHubOidcClaims, policy: GitHubOidcPolicy): boolean {
  return policy.refAllow.some(
    (shape) =>
      claims.ref === shape.ref &&
      (shape.environment === undefined || claims.environment === shape.environment),
  );
}

function subAnchored(claims: GitHubOidcClaims, policy: GitHubOidcPolicy): boolean {
  return isNonEmpty(claims.sub) && policy.subAllow.includes(claims.sub);
}

/**
 * The pure claims allowlist (testable without jose). Enforces audience,
 * issuer, repository, the workflow_ref/job_workflow_ref deploy-workflow
 * constraint, and the per-environment ref/sub anchor exactly per MED-2.
 * At least one of workflow_ref/job_workflow_ref must be present and trusted;
 * a token carrying neither (or an untrusted one) is rejected fail-closed.
 */
export function enforceGitHubOidcAllowlist(
  claims: GitHubOidcClaims,
  policy: GitHubOidcPolicy,
): GitHubOidcAllowlistResult {
  if (claims.iss !== policy.issuer) {
    return { ok: false, reason: `untrusted issuer ${claims.iss ?? "(missing)"}` };
  }
  if (!audienceMatches(policy, claims.aud)) {
    return { ok: false, reason: `audience not allowed for this project` };
  }
  if (claims.repository !== policy.repository) {
    return { ok: false, reason: `untrusted repository ${claims.repository ?? "(missing)"}` };
  }
  // Every workflow ref the token carries must be a trusted deploy workflow,
  // and at least one must be present (fail closed on a naked token).
  const hasRef = claims.workflow_ref !== undefined || claims.job_workflow_ref !== undefined;
  const allTrusted =
    (claims.workflow_ref === undefined || trustedWorkflow(claims.workflow_ref, policy)) &&
    (claims.job_workflow_ref === undefined || trustedWorkflow(claims.job_workflow_ref, policy));
  if (!hasRef || !allTrusted) {
    return { ok: false, reason: `workflow_ref/job_workflow_ref not a trusted deploy workflow` };
  }
  if (!refAnchored(claims, policy) && !subAnchored(claims, policy)) {
    return { ok: false, reason: `claims not anchored to the target environment (MED-2)` };
  }
  return { ok: true };
}

export interface GitHubOidcVerifier {
  verify(token: string): Promise<GitHubOidcVerificationResult>;
}

/**
 * Factory returning the OIDC verifier. `jwks` is the injected get-key
 * (tests pass a local JWKS; production passes GitHub's remote JWKS).
 */
export function createGitHubOidcVerifier(
  policy: GitHubOidcPolicy,
  jwks: JWTVerifyGetKey,
): GitHubOidcVerifier {
  return {
    async verify(token: string): Promise<GitHubOidcVerificationResult> {
      let payload: JWTPayload;
      try {
        ({ payload } = await jwtVerify(token, jwks, {
          algorithms: ["RS256"],
          issuer: policy.issuer,
          audience: policy.audience,
        }));
      } catch {
        return { ok: false, reason: "OIDC token failed signature or exp/iss/aud validation" };
      }
      const allowed = enforceGitHubOidcAllowlist(payload as GitHubOidcClaims, policy);
      return allowed.ok ? { ok: true, claims: payload as GitHubOidcClaims } : allowed;
    },
  };
}