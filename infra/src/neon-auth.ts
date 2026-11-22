// Neon Auth staging declarations (AUTH-2 #950).
//
// The edge Worker (`workers/api/src/identity/auth.ts`) verifies staging JWTs
// against exactly one source of truth: the branch's JWKS URL. This module
// declares where that URL comes from and the QA login the E2E suite and local
// login script use. The same derivation is pinned against the checked runtime
// config, preventing the split-var placeholder gap documented in
// `docs/ops/auth-migration-neon.md` §8.
//
// `jwksUrlFromAuthBaseUrl` is the JWKS address's one definition: only this
// program and `database-access/` derive the address, and
// `database-access/store-secrets.ts` imports it from here. `issuerFromJwksUrl`
// is a copy of `packages/contract/src/neon-auth.ts`, the one the API Worker
// imports: CD applies both programs from a sealed tree that carries `infra/`
// alone (`.github/scripts/release/seal-foundation.sh`), so neither can take that
// package as a dependency. `packages/contract/test/neon-auth.test.ts` pins the
// address and binds the issuer copy to the contract's, and this package's
// `pnpm test` runs it as `test:neon-auth-parity`.
//
// Pure functions only — no resources, no side effects, no imports — so that
// test can load them without a Pulumi runtime.

const JWKS_SUFFIX = "/.well-known/jwks.json";

/** Derive the edge's JWKS URL from the branch's Better Auth base URL. */
export function jwksUrlFromAuthBaseUrl(baseUrl: string): string {
  return `${baseUrl.replace(/[/]+$/, "")}${JWKS_SUFFIX}`;
}

/** Derive the issuer/audience (the Neon Auth host origin) from a JWKS URL. */
export function issuerFromJwksUrl(jwksUrl: string): string {
  return new URL(jwksUrl).origin;
}

/** Env var the edge reads its JWKS from (also the Secrets Store secret name). */
export const NEON_AUTH_JWKS_VAR = "NEON_AUTH_JWKS_URL";

/** QA login env vars — Path A of `docs/ops/auth-migration-neon.md` §4. */
export const QA_NEON_USER_EMAIL_VAR = "QA_NEON_USER_EMAIL";
export const QA_NEON_USER_PASSWORD_VAR = "QA_NEON_USER_PASSWORD";
