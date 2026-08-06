import { Hono, type Context } from "hono";
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

function coldStartFailure(error: unknown): { ok: false; failure: Error } {
  if (isNotRunningError(error)) return { ok: false, failure: error };
  throw error;
}

/** One container fetch attempt: the response to return, or the failure to
 * retry (re-thrown immediately when it is not a cold-start failure). */
type FetchAttempt = { ok: true; response: Response } | { ok: false; failure: Response | Error };

async function containerFetchAttempt(
  fetchFn: (request: Request) => Promise<Response>, request: Request,
): Promise<FetchAttempt> {
  try {
    const response = await fetchFn(request);
    return (await isNotRunningResponse(response)) ? { ok: false, failure: response } : { ok: true, response };
  } catch (error) {
    return coldStartFailure(error);
  }
}

function finalFailureResponse(failure: Response | Error): Response {
  if (failure instanceof Error) throw failure;
  return failure;
}

async function fetchAttempt(
  fetchFn: (request: Request) => Promise<Response>,
  request: Request,
  attempt: number,
  sleep: (ms: number) => Promise<void>,
): Promise<FetchAttempt> {
  if (attempt > 0) await sleep(startupBackoffMs(attempt));
  return containerFetchAttempt(fetchFn, request);
}

async function fetchContainerWithStartupRetry(
  fetchFn: (request: Request) => Promise<Response>, request: Request, sleep: (ms: number) => Promise<void>,
): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const outcome = await fetchAttempt(fetchFn, request.clone(), attempt, sleep);
    if (outcome.ok || attempt === NOT_RUNNING_RETRIES - 1) {
      return outcome.ok ? outcome.response : finalFailureResponse(outcome.failure);
    }
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

function healthzHandler(c: Context<{ Bindings: Env }>, sleep: (ms: number) => Promise<void>): Promise<Response> {
  const container = c.env.CONTAINER.get(c.env.CONTAINER.idFromName("default"));
  return fetchContainerWithStartupRetry((request) => container.fetch(request), c.req.raw, sleep);
}

async function animeOverviewHandler(c: Context<{ Bindings: Env }>, showcaseMode: ShowcaseMode): Promise<Response> {
  // Showcase mode (GOAL C / C9): deny the public catalog read like every
  // other functional route — the landing needs no API data.
  if (showcaseMode.isEnabled(c.env.EDGE_SHOWCASE_MODE)) return showcaseDenied();
  if (new URL(c.req.url).search) return c.text("Unexpected query parameters", 400);
  return forwardPublicCatalog(c.env, c.req.raw);
}

function registerAssetRoutes(app: WorkerApp, deps: WorkerDeps, showcaseMode: ShowcaseMode): void {
  app.get("/healthz", (c) => healthzHandler(c, deps.sleep ?? realSleep));
  app.all("/tiles/*", (c) => handleTiles(c.req.raw, c.env.MAP_TILES, c.executionCtx));
  app.all("/img/*", (c) => handleImageProxy(c.req.raw, c.executionCtx));
  app.get("/catalog/public/anime-overview/:bangumiId{[0-9]+}", (c) => animeOverviewHandler(c, showcaseMode));
  app.all("/catalog/public/*", (c) => c.notFound());
}

function forwardedIdentity(
  env: Env, request: Request, auth: AuthResult & { ok: true }, pathname: string,
): Promise<Response> {
  const identity = { userId: auth.userId, userType: auth.userType };
  if (pathname === SESSION_MIGRATE_PATH) return handleSessionMigrate(env, request, identity);
  return authenticatedForward(env, request, identity, pathname);
}

async function anonymousOrUnauthorized(
  c: Context<{ Bindings: Env }>, deps: V1Deps, pathname: string,
): Promise<Response> {
  const anonymous = isAnonymousV1(pathname)
    ? await handleAnonymousV1(c.env, c.req.raw, Date.now(), deps.turnstileGate)
    : null;
  if (anonymous !== null) return anonymous;
  return c.json(UNAUTHORIZED_BODY, 401);
}

interface V1Deps {
  authenticate: (request: Request, env: Env, ctx: WorkerExecutionContext) => Promise<AuthResult>;
  turnstileGate: TurnstileGate;
}

async function handleV1Request(
  c: Context<{ Bindings: Env }>, deps: V1Deps,
): Promise<Response> {
  const { pathname } = new URL(c.req.url);
  if (isPublicV1(pathname)) return forwardV1(c.env, c.req.raw);
  const auth = await deps.authenticate(c.req.raw, c.env, c.executionCtx);
  if (auth.ok) return forwardedIdentity(c.env, c.req.raw, auth, pathname);
  if (auth.reason === "invalid") return unauthorized(pathname);
  return anonymousOrUnauthorized(c, deps, pathname);
}

// /v1/users/* bypasses the container entirely: the users service verifies the Neon
// Auth JWT itself (jose JWKS), so the edge passes Authorization through untouched.
function registerV1Routes(
  app: WorkerApp, authenticate: V1Deps["authenticate"], turnstileGate: TurnstileGate, showcaseMode: ShowcaseMode,
): void {
  app.all("/v1/users/*", (c) => {
    if (showcaseMode.isEnabled(c.env.EDGE_SHOWCASE_MODE)) return showcaseDenied();
    return c.env.USERS.fetch(c.req.raw);
  });
  app.all("/v1/*", (c) => {
    if (showcaseMode.isEnabled(c.env.EDGE_SHOWCASE_MODE)) return showcaseDenied();
    return handleV1Request(c, { authenticate, turnstileGate });
  });
}

interface ResolvedGates {
  authenticate: (request: Request, env: Env, ctx: WorkerExecutionContext) => Promise<AuthResult>;
  turnstileGate: TurnstileGate;
  showcaseMode: ShowcaseMode;
}

function resolveGates(deps: WorkerDeps): ResolvedGates {
  // One gate per app instance, built outside the request handlers so their
  // pass window / warn-once dedupe is shared by every request on the same
  // isolate — tests inject their own to keep state out of module scope.
  const authenticate = deps.authenticate ?? ((req, env, ctx) => realAuthenticate(req, env, fetch, ctx));
  const turnstileGate = deps.turnstileGate ?? createTurnstileGate();
  const showcaseMode = deps.showcaseMode ?? createShowcaseMode();
  return { authenticate, turnstileGate, showcaseMode };
}

function registerWorkerRoutes(app: WorkerApp, deps: WorkerDeps): void {
  app.notFound(() => Response.json(NOT_FOUND_BODY, { status: 404 }));
  const gates = resolveGates(deps);
  registerAssetRoutes(app, deps, gates.showcaseMode);
  registerV1Routes(app, gates.authenticate, gates.turnstileGate, gates.showcaseMode);
}

export function createWorkerApp(deps: WorkerDeps): WorkerApp {
  const app = new Hono<{ Bindings: Env }>();
  registerWorkerRoutes(app, deps);
  return app;
}
