/**
 * The issuer a Neon Auth JWT carries, read off the branch's JWKS address (AUTH-2 #950).
 *
 * Neon Auth publishes a branch's signing keys under its Better Auth base path
 * (`…/neondb/auth/.well-known/jwks.json`), but a token's `iss` and `aud` are the auth host's
 * origin alone. The API Worker, this module's one runtime consumer, reads the issuer from here.
 *
 * The address itself has one definition, `jwksUrlFromAuthBaseUrl` in `infra/src/neon-auth.ts`:
 * only the two Pulumi programs derive it, and they cannot import this package because CD applies
 * them from a sealed tree that carries `infra/` alone. For the same reason infra keeps a copy of
 * the issuer, and `test/neon-auth.test.ts` binds both copies to the same literal outputs.
 *
 * Import-free, like every contract module the API Worker reads at runtime
 * (`test/import-free-modules.test.ts`).
 */

/** The issuer and audience of a Neon Auth JWT: the JWKS address's origin. Throws a
 * `TypeError` for an address `URL` cannot parse. */
export function issuerFromJwksUrl(jwksUrl: string): string {
  return new URL(jwksUrl).origin;
}
