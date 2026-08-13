/// <reference types="@cloudflare/workers-types" />

import type { Env, WorkerExecutionContext } from "../env.ts";
import type { AuthResult } from "../identity/auth.ts";
import { handleAnonymousV1 } from "../identity/anonymous-flow.ts";
import { handleSessionAdopt, SESSION_ADOPT_PATH } from "../identity/session-adopt.ts";
import { handleImageProxy } from "../proxy/image-proxy.ts";
import { handleTiles } from "../proxy/tiles.ts";
import type { ShowcaseMode } from "../proxy/showcase.ts";
import type { TurnstileGate } from "../protect/turnstile.ts";
import { USERS_BINDING_PREFIX } from "@animichi/contract/internal-binding";
import { authenticatedRateLimitKey, authRateLimitConfigFrom } from "../protect/rate-limiter.ts";
import { guardPolicy } from "../protect/burst-guard.ts";
import { authenticatedForward, forwardPublicCatalog, forwardUsers, forwardV1 } from "./forward.ts";
import { classifyRatePolicy } from "./rate-policy.ts";
import { METHOD_NOT_ALLOWED_BODY, NOT_FOUND_BODY, UNAUTHORIZED_BODY, showcaseDenied, unauthorized } from "./responses.ts";
import { isAnonymousV1, isPublicV1 } from "./routing-policy.ts";

// ── EDGE-1 #963: the composed gateway seam ─────────────────────────────────
//
// HandleGatewayRequest is the single request surface of the edge worker:
// route selection, the showcase gate, identity verification (Neon), the
// anonymous pipeline (mint → Turnstile → limiter → budget), the
// authenticated limiter, trusted internal-identity construction, and
// forwarding to Catalog / Users / the agent container run here, in that
// order. app.ts delegates to it once.

/** The legacy anonymous-session migration path deleted with AdoptSessions
 * (SESSION-2 #960). Explicitly rejected here so no branch can ever forward a
 * request to a route that no longer exists. */
const SESSION_MIGRATE_PATH = "/v1/session/migrate";

/** The one allowlisted public catalog read (issue #537 / CATALOG-5 #946). */
const PUBLIC_CATALOG_PATTERN = /^\/catalog\/public\/anime-overview\/\d+$/;

const USERS_PREFIX = USERS_BINDING_PREFIX;

/** Container cold-start hardening (issue #694): while a container is still
 * starting, its fetch answers a 500 whose body carries this marker (or throws
 * an error that does). /healthz retries briefly instead of failing the
 * readiness probe, then passes the final failure through unchanged. */
const NOT_RUNNING_MARKER = "The container is not running";
const NOT_RUNNING_RETRIES = 3;

type RequestClass =
  | { kind: "landing"; asset: "healthz" | "banner" | "tiles" | "img" }
  | { kind: "public-catalog" }
  | { kind: "users" }
  | { kind: "adopt" }
  | { kind: "v1"; pathname: string }
  | { kind: "retired" }
  | { kind: "not-found" };

/** The landing surface, which the showcase gate never denies. */
function landingClass(method: string, pathname: string): RequestClass | null {
  if (pathname === "/healthz" && method === "GET") return { kind: "landing", asset: "healthz" };
  // The agent's JSON service banner at the root (CONTRACT-1 #938). Not an HTML
  // page — #537 retired the page renderer, not the container's root JSON — so
  // forwarding it to the container keeps every advertised Agent operation
  // reachable through the CONTAINER binding (#1005 AC1).
  if (pathname === "/" && method === "GET") return { kind: "landing", asset: "banner" };
  if (pathname.startsWith("/tiles/")) return { kind: "landing", asset: "tiles" };
  if (pathname.startsWith("/img/")) return { kind: "landing", asset: "img" };
  return null;
}

/** Pure route selection: one classification per request, no bindings read. */
function classify(request: Request): RequestClass {
  const { pathname } = new URL(request.url);
  const landing = landingClass(request.method, pathname);
  if (landing !== null) return landing;
  if (request.method === "GET" && PUBLIC_CATALOG_PATTERN.test(pathname)) return { kind: "public-catalog" };
  if (pathname === SESSION_MIGRATE_PATH) return { kind: "retired" };
  if (pathname.startsWith(USERS_PREFIX)) return { kind: "users" };
  if (pathname === SESSION_ADOPT_PATH) return { kind: "adopt" };
  if (pathname.startsWith("/v1/")) return { kind: "v1", pathname };
  return { kind: "not-found" };
}

/** Functional routes are denied in showcase mode; the landing surface stays. */
function isFunctionalRoute(route: RequestClass): boolean {
  return route.kind !== "landing" && route.kind !== "not-found";
}

/** Structured, credential-free request record (EDGE-1 #963): identity kind
 * (class), upstream status and duration only — never a token, trusted
 * header, user identifier, path or payload. */
function observe(route: RequestClass, response: Response, startedMs: number): void {
  console.warn(JSON.stringify({
    event: "edge_gateway_request",
    class: route.kind,
    status: response.status,
    duration_ms: Date.now() - startedMs,
  }));
}

function notFoundResponse(): Response {
  return Response.json(NOT_FOUND_BODY, { status: 404 });
}

function methodNotAllowed(): Response {
  return Response.json(METHOD_NOT_ALLOWED_BODY, { status: 405 });
}

type AuthFailure = Extract<AuthResult, { ok: false }>;

/** The shared credential-rejection branch: invalid logs the 401 storm
 * record; absent is a flat 401 with no record (issue #441). */
function authenticationRejection(request: Request, auth: AuthFailure): Response {
  const { pathname } = new URL(request.url);
  return auth.reason === "invalid" ? unauthorized(pathname) : Response.json(UNAUTHORIZED_BODY, { status: 401 });
}

export interface GatewayDeps {
  authenticate: (request: Request, env: Env, ctx: WorkerExecutionContext) => Promise<AuthResult>;
  turnstileGate: TurnstileGate;
  showcaseMode: ShowcaseMode;
  sleep: (ms: number) => Promise<void>;
}

export async function HandleGatewayRequest(
  env: Env, request: Request, ctx: WorkerExecutionContext, deps: GatewayDeps,
): Promise<Response> {
  const route = classify(request);
  const startedMs = Date.now();
  const response = isFunctionalRoute(route) && deps.showcaseMode.isEnabled(env.EDGE_SHOWCASE_MODE)
    ? showcaseDenied()
    : await dispatch(route, env, request, ctx, deps);
  observe(route, response, startedMs);
  return response;
}

function dispatch(route: RequestClass, env: Env, request: Request, ctx: WorkerExecutionContext, deps: GatewayDeps): Promise<Response> {
  switch (route.kind) {
    case "landing": return landingResponse(env, request, ctx, route.asset, deps.sleep);
    case "public-catalog": return publicCatalogResponse(env, request);
    case "users": return usersResponse(env, request, ctx, deps);
    case "adopt": return adoptResponse(env, request, ctx, deps);
    case "v1": return agentV1Response(env, request, ctx, route.pathname, deps);
    case "retired": return Promise.resolve(notFoundResponse());
    case "not-found": return Promise.resolve(notFoundResponse());
  }
}

function landingResponse(
  env: Env, request: Request, ctx: WorkerExecutionContext, asset: "healthz" | "banner" | "tiles" | "img", sleep: (ms: number) => Promise<void>,
): Promise<Response> {
  if (asset === "healthz") return healthzResponse(env, request, sleep);
  if (asset === "banner") return bannerResponse(env, request);
  if (asset === "tiles") return handleTiles(request, env.MAP_TILES, ctx);
  return handleImageProxy(request, ctx);
}

/** Forward `GET /` to the container's root banner (no startup retry needed —
 * a missed banner is a soft miss, unlike the readiness probe). */
function bannerResponse(env: Env, request: Request): Promise<Response> {
  const container = env.CONTAINER.get(env.CONTAINER.idFromName("default"));
  return container.fetch(request);
}

function healthzResponse(env: Env, request: Request, sleep: (ms: number) => Promise<void>): Promise<Response> {
  const container = env.CONTAINER.get(env.CONTAINER.idFromName("default"));
  return fetchContainerWithStartupRetry((inner) => container.fetch(inner), request, sleep);
}

/** Coarse key for a credential-free public read: the connecting IP when the
 * platform supplies it (best-effort identity isolation on the native damper),
 * else a shared literal so the damper still counts per-request. */
function publicReadKey(request: Request): string {
  const ip = request.headers.get("CF-Connecting-IP");
  return ip && ip.length > 0 ? `ip:${ip}` : "public-read";
}

async function publicCatalogResponse(env: Env, request: Request): Promise<Response> {
  if (new URL(request.url).search) return Promise.resolve(new Response("Unexpected query parameters", { status: 400 }));
  const guarded = await guardPolicy(env, classifyRatePolicy(request.method, new URL(request.url).pathname), publicReadKey(request), authRateLimitConfigFrom(env));
  if (guarded !== null) return guarded;
  return forwardPublicCatalog(env, request);
}

async function usersResponse(
  env: Env, request: Request, ctx: WorkerExecutionContext, deps: GatewayDeps,
): Promise<Response> {
  const auth = await deps.authenticate(request, env, ctx);
  if (!auth.ok) return authenticationRejection(request, auth);
  // User-account mutations (POST/DELETE) are an exact durable fail-closed
  // write class (AC2/AC4) per the route policy; GET reads classify unmanaged
  // and are never metered. One decision path: classify then `guardPolicy`.
  const guarded = await guardPolicy(
    env,
    classifyRatePolicy(request.method, new URL(request.url).pathname),
    authenticatedRateLimitKey(auth.userId),
    authRateLimitConfigFrom(env),
  );
  if (guarded !== null) return guarded;
  return forwardUsers(env, request, auth);
}

async function adoptResponse(
  env: Env, request: Request, ctx: WorkerExecutionContext, deps: GatewayDeps,
): Promise<Response> {
  if (request.method !== "POST") return methodNotAllowed();
  const auth = await deps.authenticate(request, env, ctx);
  if (!auth.ok) return authenticationRejection(request, auth);
  // Adoption is a state-migrating WRITE: the route policy classifies it as a
  // durable fail-closed mutation, so it rides the same `guardPolicy` seam.
  const guarded = await guardPolicy(
    env,
    classifyRatePolicy(request.method, new URL(request.url).pathname),
    authenticatedRateLimitKey(auth.userId),
    authRateLimitConfigFrom(env),
  );
  if (guarded !== null) return guarded;
  return handleSessionAdopt(env, request, auth);
}

async function agentV1Response(
  env: Env, request: Request, ctx: WorkerExecutionContext, pathname: string, deps: GatewayDeps,
): Promise<Response> {
  if (isPublicV1(pathname)) {
    // Cacheable public reads are the policy's native fail-open cell; guard
    // via the same `guardPolicy` seam using the request's public key.
    const guarded = await guardPolicy(env, classifyRatePolicy(request.method, pathname), publicReadKey(request), authRateLimitConfigFrom(env));
    if (guarded !== null) return guarded;
    return forwardV1(env, request);
  }
  const auth = await deps.authenticate(request, env, ctx);
  if (auth.ok) return authenticatedForward(env, request, auth, pathname);
  if (auth.reason === "invalid") return unauthorized(pathname);
  if (isAnonymousV1(pathname)) {
    const anonymous = await handleAnonymousV1(env, request, Date.now(), deps.turnstileGate);
    if (anonymous !== null) return anonymous;
  }
  return Response.json(UNAUTHORIZED_BODY, { status: 401 });
}

/** Backoff before the 2nd and 3rd attempts: 400ms then 800ms (issue #694). */
function startupBackoffMs(attempt: number): number {
  return attempt === 1 ? 400 : 800;
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
