import { BEARER_SCHEME, constantTimeEqual, type AuthEnv } from "./auth.ts";

export interface AuthConfigStatus {
  neonAuthEnabled: boolean;
  /** null when Neon Auth is disabled — there is nothing to check. */
  jwksIssuerMatch: boolean | null;
}

export interface AuthConfigDiagEnv extends AuthEnv {
  /** Shared bearer secret gating GET /internal/auth-config (issue #709
   * review follow-up). Provisioned as a GitHub environment secret, pushed
   * to the Worker the same way TURNSTILE_SECRET/ANON_ID_SECRET are, and
   * handed to post-deploy-assert.sh's auth-config-check as
   * POST_DEPLOY_DIAG_TOKEN — see .github/workflows/_deploy-component.yml
   * and _post-deploy-test.yml. */
  POST_DEPLOY_DIAG_TOKEN?: string;
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
 * Returns booleans only — never the URL strings themselves — so a leak of
 * this response body cannot hand out a URL. That is NOT the same as safe to
 * expose unauthenticated, though: "is Neon Auth currently broken in this
 * environment" is itself a signal worth denying to an anonymous caller (a
 * `true` here means every login is failing right now) — see
 * `isDiagAuthorized` below, which gates the route this feeds.
 */
export function authConfigStatus(env: AuthEnv): AuthConfigStatus {
  if (env.NEON_AUTH_ENABLED !== "true") return { neonAuthEnabled: false, jwksIssuerMatch: null };
  const issuer = env.NEON_AUTH_ISSUER ?? "";
  const jwks = env.NEON_AUTH_JWKS_URL ?? "";
  const match = issuer.length > 0 && jwks === `${issuer}/.well-known/jwks.json`;
  return { neonAuthEnabled: true, jwksIssuerMatch: match };
}

/**
 * Gate for GET /internal/auth-config (issue #709 review follow-up): the
 * route sits after /healthz and before the /v1/* authenticate() chain in
 * app.ts, so without this it would be reachable by anyone on the public
 * internet with no credential at all. `/internal/` names an intent, not a
 * network boundary on a Cloudflare Worker — every route on this Worker is
 * public HTTP unless code says otherwise, so the naming alone protects
 * nothing. Fails closed: an unset POST_DEPLOY_DIAG_TOKEN denies every
 * request rather than becoming an open route by omission.
 */
export function isDiagAuthorized(request: Request, env: AuthConfigDiagEnv): boolean {
  const expected = env.POST_DEPLOY_DIAG_TOKEN ?? "";
  if (expected.length === 0) return false;
  const header = request.headers.get("Authorization") ?? "";
  const scheme = BEARER_SCHEME.exec(header);
  if (scheme === null) return false;
  return constantTimeEqual(header.slice(scheme[0].length).trim(), expected);
}
