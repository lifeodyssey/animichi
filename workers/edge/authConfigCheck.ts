import type { AuthEnv } from "./auth.ts";

export interface AuthConfigStatus {
  neonAuthEnabled: boolean;
  /** null when Neon Auth is disabled — there is nothing to check. */
  jwksIssuerMatch: boolean | null;
}

/**
 * Runtime-only diagnostic (issue #709). Compares the ACTUALLY BOUND
 * `NEON_AUTH_JWKS_URL` secret against the value derived from the ACTUALLY
 * BOUND `NEON_AUTH_ISSUER` var, inside the running Worker isolate — not the
 * static `wrangler.toml` `var`, which is all `workers/edge/authConfig.test.ts`
 * can see. A GitHub Actions secret scanner or a config-time test can only
 * ever see what is written in this repo; the secret's real deployed value
 * only ever exists inside a live Worker's `env`, so this is the one place a
 * drift (a `NEON_AUTH_JWKS_URL` rotated or copy-pasted wrong between
 * environments) can actually be observed.
 *
 * Returns booleans only — never the URL strings themselves — so this stays
 * safe to expose on an unauthenticated diagnostic route (see issue #673: a
 * prior incident where a real endpoint URL leaked into a public repo).
 */
export function authConfigStatus(env: AuthEnv): AuthConfigStatus {
  if (env.NEON_AUTH_ENABLED !== "true") return { neonAuthEnabled: false, jwksIssuerMatch: null };
  const issuer = env.NEON_AUTH_ISSUER ?? "";
  const jwks = env.NEON_AUTH_JWKS_URL ?? "";
  const match = issuer.length > 0 && jwks === `${issuer}/.well-known/jwks.json`;
  return { neonAuthEnabled: true, jwksIssuerMatch: match };
}
