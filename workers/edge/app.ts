import { Hono } from "hono";
import { type AuthResult, authenticate as realAuthenticate } from "./auth.ts";
import { authConfigStatus, isDiagAuthorized } from "./authConfigCheck.ts";
import type { Env, WorkerExecutionContext } from "./env.ts";
import { authenticatedForward, forwardPublicCatalog, forwardV1 } from "./forward.ts";
import { handleAnonymousV1 } from "./anonymous-flow.ts";
import { handleImageProxy } from "./image-proxy.ts";
import { NOT_FOUND_BODY, UNAUTHORIZED_BODY, unauthorized } from "./responses.ts";
import { isAnonymousV1, isPublicV1 } from "./routing-policy.ts";
import { handleSessionMigrate, SESSION_MIGRATE_PATH } from "./session-migrate.ts";
import { handleTiles } from "./tiles.ts";
import { createTurnstileGate, type TurnstileGate } from "./turnstile.ts";

export type { Env } from "./env.ts";
export { catalogOutbound } from "./forward.ts";
export { isAuthRateLimited } from "./routing-policy.ts";

/** The main Worker app: a pure API and asset gateway (`/v1`, `/healthz`, the
 * image and private R2 tile proxies, and one allowlisted public catalog read).
 * NOTE: no /catalog/* route —
 * catalog is private (reached only via the container outboundByHost binding,
 * never the public internet).
 *
 * Issue #537 removed the OpenNext catch-all that used to render the legacy
 * Next.js homepage here; `apps/web` owns every HTML surface now. Unmatched
 * paths answer `NOT_FOUND_BODY` instead of a page — see its comment for why
 * that is a hard 404 and not a friendly 200. */
type WorkerApp = Hono<{ Bindings: Env }>;
interface WorkerDeps {
  authenticate?: (request: Request, env: Env, ctx: WorkerExecutionContext) => Promise<AuthResult>;
  turnstileGate?: TurnstileGate;
}

function registerWorkerRoutes(app: WorkerApp, deps: WorkerDeps): void {
  app.notFound(() => Response.json(NOT_FOUND_BODY, { status: 404 }));
  const authenticate = deps.authenticate ?? ((req, env, ctx) => realAuthenticate(req, env, fetch, ctx));
  // One gate per app instance, built outside the request handler so its
  // short-lived pass window is shared by every request on the same isolate —
  // that window is what stops a visitor being re-challenged per message.
  const turnstileGate = deps.turnstileGate ?? createTurnstileGate();
  app.get("/healthz", (c) =>
    c.env.CONTAINER.get(c.env.CONTAINER.idFromName("default")).fetch(c.req.raw),
  );
  // Post-deploy secret-drift check (issue #709): booleans only, no secret
  // values — see authConfigCheck.ts for why this must run inside the Worker.
  // Gated by a shared bearer secret (review follow-up, same issue): an
  // unauthorized request gets the same 404 as any unmapped path — this
  // route's existence, not just its payload, is not for public consumption.
  app.get("/internal/auth-config", (c) =>
    isDiagAuthorized(c.req.raw, c.env) ? c.json(authConfigStatus(c.env)) : c.notFound(),
  );
  app.all("/tiles/*", (c) => handleTiles(c.req.raw, c.env.MAP_TILES, c.executionCtx));
  app.all("/img/*", (c) => handleImageProxy(c.req.raw, c.executionCtx));
  app.get("/catalog/public/anime-overview/:bangumiId{[0-9]+}", async (c) => {
    if (new URL(c.req.url).search) return c.text("Unexpected query parameters", 400);
    return forwardPublicCatalog(c.env, c.req.raw);
  });
  app.all("/catalog/public/*", (c) => c.notFound());
  // Hono runs the first matching handler in registration order.
  // /v1/users/* bypasses the container entirely: the users service verifies the
  // Neon Auth JWT itself (jose JWKS), so the edge passes Authorization through
  // untouched. Different trust model from the container /v1/* path — do not
  // funnel this through authenticate()/forwardV1.
  app.all("/v1/users/*", (c) => c.env.USERS.fetch(c.req.raw));
  app.all("/v1/*", async (c) => {
    const { pathname } = new URL(c.req.url);
    if (isPublicV1(pathname)) return forwardV1(c.env, c.req.raw);
    const auth = await authenticate(c.req.raw, c.env, c.executionCtx);
    if (auth.ok) {
      const identity = { userId: auth.userId, userType: auth.userType };
      // Session migration runs ahead of the per-identity rate limiter (#284
      // Task 9): it is an identity-only DB update, not a cost-bearing route,
      // and is not in AUTH_RATE_LIMITED_EXACT — routing it through
      // authenticatedForward would be a silent no-op today, but checking it
      // first keeps that true by construction rather than by omission.
      if (pathname === SESSION_MIGRATE_PATH) {
        return handleSessionMigrate(c.env, c.req.raw, identity);
      }
      return authenticatedForward(c.env, c.req.raw, identity, pathname);
    }
    // S1.9 Turnstile (issue #281) is ARMED as of issue #447: `handleAnonymousV1`
    // below challenges every anonymous turn before it can reach the limiter or
    // the container. Without it, dropping the `aid` cookie mints a fresh
    // identity and resets the per-identity limiter, leaving the daily dollar
    // breaker as the only guard — i.e. a paid-for daily DoS.
    // Issue #441: only a caller who presented NO credential may be demoted to
    // an anonymous identity. A presented-but-unverifiable one (expired,
    // malformed, wrong key) falls straight through to the 401 below, which is
    // what puts the web client back on its token-refresh path.
    if (auth.reason === "invalid") return unauthorized(pathname);
    const anonymous = isAnonymousV1(pathname)
      ? await handleAnonymousV1(c.env, c.req.raw, Date.now(), turnstileGate)
      : null;
    if (anonymous !== null) return anonymous;
    return c.json(UNAUTHORIZED_BODY, 401);
  });
}

export function createWorkerApp(deps: WorkerDeps): WorkerApp {
  const app = new Hono<{ Bindings: Env }>();
  registerWorkerRoutes(app, deps);
  return app;
}
