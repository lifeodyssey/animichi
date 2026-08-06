import { Hono } from "hono";
import { type AuthResult, authenticate as realAuthenticate } from "./auth.ts";
import type { Env, WorkerExecutionContext } from "./env.ts";
import { authenticatedForward, forwardPublicCatalog, forwardV1 } from "./forward.ts";
import { handleAnonymousV1 } from "./anonymous-flow.ts";
import { handleImageProxy } from "./image-proxy.ts";
import { NOT_FOUND_BODY, UNAUTHORIZED_BODY, showcaseDenied, unauthorized } from "./responses.ts";
import { isAnonymousV1, isPublicV1 } from "./routing-policy.ts";
import { createShowcaseMode, type ShowcaseMode } from "./showcase.ts";
import { handleSessionMigrate, SESSION_MIGRATE_PATH } from "./session-migrate.ts";
import { handleTiles } from "./tiles.ts";
import { createTurnstileGate, type TurnstileGate } from "./turnstile.ts";

export type { Env } from "./env.ts";
export { catalogOutbound } from "./forward.ts";
export { isAuthRateLimited } from "./routing-policy.ts";

/** Container cold-start hardening (issue #694): while a container is still
 * starting, its fetch answers a 500 whose body carries this marker (or throws
 * an error that does). /healthz retries briefly instead of failing the
 * readiness probe, then passes the final failure through unchanged. */
// Exact phrase from the error string raised by @cloudflare/containers start().
const NOT_RUNNING_MARKER = "The container is not running";
const NOT_RUNNING_RETRIES = 3;

/** Backoff before the 2nd and 3rd attempts: 400ms then 800ms (issue #694). */
function startupBackoffMs(attempt: number): number {
  return attempt === 1 ? 400 : 800;
}

function realSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isNotRunningError(error: unknown): error is Error {
  return error instanceof Error && error.message.includes(NOT_RUNNING_MARKER);
}

async function isNotRunningResponse(response: Response): Promise<boolean> {
  if (response.status !== 500) return false;
  return (await response.clone().text()).includes(NOT_RUNNING_MARKER);
}

/** One container fetch attempt: the response to return, or the failure to
 * retry (re-thrown immediately when it is not a cold-start failure). */
async function containerFetchAttempt(
  fetchFn: (request: Request) => Promise<Response>,
  request: Request,
): Promise<{ ok: true; response: Response } | { ok: false; failure: Response | Error }> {
  try {
    const response = await fetchFn(request);
    if (!(await isNotRunningResponse(response))) return { ok: true, response };
    return { ok: false, failure: response };
  } catch (error) {
    if (!isNotRunningError(error)) throw error;
    return { ok: false, failure: error };
  }
}

function finalFailureResponse(failure: Response | Error): Response {
  if (failure instanceof Error) throw failure;
  return failure;
}

async function fetchContainerWithStartupRetry(
  fetchFn: (request: Request) => Promise<Response>,
  request: Request,
  sleep: (ms: number) => Promise<void>,
): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const lastAttempt = attempt === NOT_RUNNING_RETRIES - 1;
    if (attempt > 0) await sleep(startupBackoffMs(attempt));
    const outcome = await containerFetchAttempt(fetchFn, request.clone());
    if (lastAttempt) {
      return outcome.ok ? outcome.response : finalFailureResponse(outcome.failure);
    }
    if (outcome.ok) return outcome.response;
  }
}

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
  /** Injectable sleep for the container cold-start retry (tests avoid real waits). */
  sleep?: (ms: number) => Promise<void>;
  /** Injectable showcase gate (tests capture its warning / isolate it per case). */
  showcaseMode?: ShowcaseMode;
}

function registerWorkerRoutes(app: WorkerApp, deps: WorkerDeps): void {
  app.notFound(() => Response.json(NOT_FOUND_BODY, { status: 404 }));
  const authenticate = deps.authenticate ?? ((req, env, ctx) => realAuthenticate(req, env, fetch, ctx));
  // One gate per app instance, built outside the request handler so its
  // short-lived pass window is shared by every request on the same isolate —
  // that window is what stops a visitor being re-challenged per message.
  const turnstileGate = deps.turnstileGate ?? createTurnstileGate();
  // One gate per app instance, built outside the request handler: its
  // warn-once dedupe is per-instance (per-isolate in production), and tests
  // inject their own to keep warning state out of module scope.
  const showcaseMode = deps.showcaseMode ?? createShowcaseMode();
  app.get("/healthz", (c) => {
    const container = c.env.CONTAINER.get(c.env.CONTAINER.idFromName("default"));
    return fetchContainerWithStartupRetry(
      (request) => container.fetch(request),
      c.req.raw,
      deps.sleep ?? realSleep,
    );
  });
  app.all("/tiles/*", (c) => handleTiles(c.req.raw, c.env.MAP_TILES, c.executionCtx));
  app.all("/img/*", (c) => handleImageProxy(c.req.raw, c.executionCtx));
  app.get("/catalog/public/anime-overview/:bangumiId{[0-9]+}", async (c) => {
    // Showcase mode (GOAL C / C9): deny the public catalog read like every
    // other functional route — the landing needs no API data.
    if (showcaseMode.isEnabled(c.env.EDGE_SHOWCASE_MODE)) return showcaseDenied();
    if (new URL(c.req.url).search) return c.text("Unexpected query parameters", 400);
    return forwardPublicCatalog(c.env, c.req.raw);
  });
  app.all("/catalog/public/*", (c) => c.notFound());
  // Hono runs the first matching handler in registration order.
  // /v1/users/* bypasses the container entirely: the users service verifies the
  // Neon Auth JWT itself (jose JWKS), so the edge passes Authorization through
  // untouched. Different trust model from the container /v1/* path — do not
  // funnel this through authenticate()/forwardV1.
  app.all("/v1/users/*", (c) => {
    if (showcaseMode.isEnabled(c.env.EDGE_SHOWCASE_MODE)) return showcaseDenied();
    return c.env.USERS.fetch(c.req.raw);
  });
  app.all("/v1/*", async (c) => {
    if (showcaseMode.isEnabled(c.env.EDGE_SHOWCASE_MODE)) return showcaseDenied();
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
