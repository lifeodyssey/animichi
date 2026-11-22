/**
 * Where a Neon Auth branch publishes the keys its JWTs are signed with, and which issuer
 * those JWTs carry (AUTH-2 #950).
 *
 * The keys sit at `<Better Auth base URL>/.well-known/jwks.json`, and a token's `iss` and
 * `aud` are the auth host's origin, not the `/neondb/auth` base path. The API Worker reads
 * the issuer from here. The two Pulumi programs cannot import this package — CD applies
 * them from a sealed tree that carries `infra/` alone — so both import one copy,
 * `infra/src/neon-auth.ts`, and `test/neon-auth.test.ts` binds it to the same outputs.
 *
 * Import-free, like every contract module the API Worker reads at runtime
 * (`test/import-free-modules.test.ts`).
 */

const JWKS_PATH = "/.well-known/jwks.json";

/** The JWKS address of a branch's Better Auth base URL; trailing slashes are dropped. */
export function jwksUrlFromAuthBaseUrl(baseUrl: string): string {
  return `${baseUrl.replace(/[/]+$/, "")}${JWKS_PATH}`;
}

/** The issuer and audience of a Neon Auth JWT: the JWKS address's origin. Throws a
 * `TypeError` for an address `URL` cannot parse. */
export function issuerFromJwksUrl(jwksUrl: string): string {
  return new URL(jwksUrl).origin;
}
