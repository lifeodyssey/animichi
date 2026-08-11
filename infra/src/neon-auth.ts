// Neon Auth staging declarations (AUTH-2 #950).
//
// The edge Worker (`workers/edge/src/identity/auth.ts`) verifies staging JWTs
// against exactly one source of truth: the branch's JWKS URL. This module
// declares where that URL comes from and the QA login the E2E suite and local
// login script use, so the derivation lives in IaC rather than as a checked-in
// literal with a hand-typed sibling (the split-var placeholder gap that
// `docs/ops/auth-migration-neon.md` §8 documented is exactly the failure this
// avoids).
//
// Pure functions only — no resources, no side effects — so the topology tests
// can pin the derivation without a Pulumi runtime.

const JWKS_SUFFIX = "/.well-known/jwks.json";

/** Derive the edge's JWKS URL from the branch's Better Auth base URL. */
export function jwksUrlFromAuthBaseUrl(baseUrl: string): string {
  return `${baseUrl.replace(/[/]+$/, "")}${JWKS_SUFFIX}`;
}

/** Derive the issuer/audience (the auth base URL) from a JWKS URL — the mirror
 * of the edge's own `issuerFromJwksUrl` in `workers/edge/src/identity/auth.ts`. */
export function issuerFromJwksUrl(jwksUrl: string): string {
  return jwksUrl.endsWith(JWKS_SUFFIX)
    ? jwksUrl.slice(0, -JWKS_SUFFIX.length)
    : jwksUrl;
}

/** Env var the edge reads its JWKS from (also the Secrets Store secret name). */
export const NEON_AUTH_JWKS_VAR = "NEON_AUTH_JWKS_URL";

/** QA login env vars — Path A of `docs/ops/auth-migration-neon.md` §4. */
export const QA_NEON_USER_EMAIL_VAR = "QA_NEON_USER_EMAIL";
export const QA_NEON_USER_PASSWORD_VAR = "QA_NEON_USER_PASSWORD";
