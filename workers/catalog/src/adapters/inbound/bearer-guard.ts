/**
 * The bearer guard in front of the two operational surfaces: the admin commands
 * (`../../import/admin-routes.ts`) and the snapshot rollback (`./snapshot.ts`).
 *
 * Hono's `bearerAuth` reads the `Authorization` header and Hono's own
 * `timingSafeEqual` compares the token: the scheme matches whatever its case
 * (RFC 7235), and every refusal carries the RFC 6750 `WWW-Authenticate`
 * challenge. A missing header, a malformed one and a wrong token all answer 401
 * `{"error":"unauthorized"}`.
 *
 * The token is resolved per request, from a plain string (tests, local dev) or a
 * Secrets Store binding. A mount with its own answer for an unset token gets that
 * answer before the header is read; without one, an unset token matches nothing.
 */
import type { MiddlewareHandler } from "hono";
import { bearerAuth } from "hono/bearer-auth";
import { timingSafeEqual } from "hono/utils/buffer";
import type { Env } from "../../index";

/** The operational secret a mount reads from the env, as wrangler binds it. */
type OperatorToken = string | SecretsStoreSecret | undefined;

interface CatalogEnv {
  Bindings: Env;
}

const UNAUTHORIZED = { error: "unauthorized" } as const;

/** One 401 body for the three refusals; a malformed header would otherwise answer 400. */
const REFUSALS = {
  noAuthenticationHeader: { message: UNAUTHORIZED },
  invalidAuthenticationHeader: { message: () => Response.json(UNAUTHORIZED, { status: 401 }) },
  invalidToken: { message: UNAUTHORIZED },
};

/**
 * Guard a route with the token `tokenOf` reads. `unconfigured`, when given, is
 * the route's answer while that token is unset; without it, an unset token
 * refuses every request the way a wrong token does.
 */
export function bearerGuard(
  tokenOf: (env: Env) => OperatorToken,
  unconfigured?: () => Response,
): MiddlewareHandler<CatalogEnv> {
  return async (c, next) => {
    const token = await resolvedToken(tokenOf(c.env));
    if (token === undefined && unconfigured !== undefined) return unconfigured();
    return bearerAuth<CatalogEnv>({ ...REFUSALS, verifyToken: (presented) => matches(token, presented) })(c, next);
  };
}

/** The token's value, read from its Secrets Store binding when it is one; `undefined` when unset or empty. */
async function resolvedToken(token: OperatorToken): Promise<string | undefined> {
  const value = typeof token === "object" ? await token.get() : token;
  return value === "" ? undefined : value;
}

/** Hono's constant-time compare; an unset token matches nothing. */
function matches(token: string | undefined, presented: string): Promise<boolean> | boolean {
  return token === undefined ? false : timingSafeEqual(token, presented);
}
