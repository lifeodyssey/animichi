/// <reference types="@cloudflare/workers-types" />
import { Hono } from "hono";
import {
  type AnonymousIdentity,
  type AuthResult,
  authenticate as realAuthenticate,
  resolveAnonymous,
  resolveAnonymousReadOnly,
} from "./auth.ts";
import {
  budgetGuidanceResponse,
  budgetLatched,
  isBudgetRejection,
  latchBudget,
  utcDayKey,
} from "./costBreaker.ts";
import type { GuardNamespace } from "./guardStore.ts";
import {
  authenticatedRateLimitKey,
  authRateLimitConfigFrom,
  checkRateLimit,
  rateLimitConfigFrom,
} from "./rateLimiter.ts";
import { catalogRequestAllowed } from "./catalogPolicy.ts";
import { type TurnstileGate, createTurnstileGate, guardTurnstile } from "./turnstile.ts";
import { handleTiles, type TileBucket } from "./tiles.ts";

export interface Env {
  CATALOG: { fetch: (req: Request) => Promise<Response> };
  USERS: { fetch: (req: Request) => Promise<Response> };
  CONTAINER: DurableObjectNamespace;
  EDGE_GUARD: GuardNamespace;
  MAP_TILES?: TileBucket;
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  /** Cloudflare Turnstile secret (Worker secret binding — never process.env). */
  TURNSTILE_SECRET: string;
  ANON_ACCESS_ENABLED?: string;
  ANON_ID_SECRET?: string;
  [key: string]: unknown;
}

type WorkerExecutionContext = Pick<ExecutionContext, "waitUntil" | "passThroughOnException">;

const PUBLIC_V1 = ["/v1/search/preview", "/v1/bangumi/popular"];
function isPublicV1(pathname: string): boolean {
  return PUBLIC_V1.includes(pathname) || /^\/v1\/bangumi\/[^/]+\/guide$/.test(pathname);
}

const PUBLIC_CATALOG_HEADERS = ["Accept"] as const;

/** Rebuild anonymous catalog headers from a minimal, non-sensitive allowlist. */
function publicCatalogHeaders(request: Request): Headers {
  const headers = new Headers();
  for (const name of PUBLIC_CATALOG_HEADERS) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  return headers;
}

/** Forward an allowlisted anonymous GET to the private CATALOG binding. */
function forwardPublicCatalog(env: Env, request: Request): Promise<Response> {
  return env.CATALOG.fetch(new Request(request, { headers: publicCatalogHeaders(request) }));
}

/** Forward a /v1 request to the container's default instance. Always strips
 * client-supplied X-User-*, X-Anon-Id (anti-forgery), and x-byok-endpoint
 * (documented as trusted by the container but client-settable — closed
 * until BYOK launches); on authed paths also strips Authorization and
 * injects the worker-verified identity. A trusted `X-Anon-Id` is set only
 * when the caller passes one explicitly (the session-migration route,
 * re-P2-1) — every other route forwards none. `x-session-id` is
 * intentionally forwarded: chat session continuity needs it, so the
 * container must never treat it as a trust signal. */
function forwardV1(
  env: Env,
  request: Request,
  auth?: { userId: string; userType: string },
  trustedAnonId?: string | null,
): Promise<Response> {
  const headers = new Headers(request.headers);
  headers.delete("X-User-Id");
  headers.delete("X-User-Type");
  headers.delete("x-byok-endpoint");
  headers.delete("X-Anon-Id");
  if (auth) {
    headers.delete("Authorization");
    headers.set("X-User-Id", auth.userId);
    headers.set("X-User-Type", auth.userType);
  }
  if (trustedAnonId) headers.set("X-Anon-Id", trustedAnonId);
  const forwarded = new Request(request, { headers });
  return env.CONTAINER.get(env.CONTAINER.idFromName("default")).fetch(forwarded);
}

// Per-identity rate limiting on the AUTHENTICATED path (issue #284 / Task 9).
// Previously this branch called no limiter at all; BYOK makes that unbounded
// (free self-serve accounts, an outbound call per turn). Scoped to
// cost-bearing routes only — counting reads (conversations/messages/routes)
// would let paging through history 429 an unrelated in-flight chat turn.
// /v1/runtime + /v1/runtime/stream (agent/interfaces/routes/runtime.py) run
// a full agent turn on the house key, same cost shape as chat — they belong
// here too; retiring these legacy routes is tracked separately.
const AUTH_RATE_LIMITED_EXACT = ["/v1/chat", "/v1/runtime", "/v1/runtime/stream"];
const AUTH_RATE_LIMITED_PREFIX = "/v1/byok/";

/** Strip one trailing slash so "/v1/chat/" counts as "/v1/chat" — a bare
 * exact-match let a trailing slash skip the limiter outright (P2-5). */
function normalizeV1Path(pathname: string): string {
  return pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
}

/**
 * Percent-decode for routing decisions only (review follow-up, #479 P1-1 /
 * #464): `URL.pathname` does NOT decode `%XX` escapes, but the container's
 * ASGI router (uvicorn/Starlette) does before matching its own routes. That
 * split-brain let `/v1/%62yok/probe` read as "not `/v1/byok/`" here — zero
 * `checkRateLimit` calls — while still landing on `handle_byok_probe` in the
 * container: an authenticated caller could burst an unbounded number of real
 * outbound probe calls by percent-encoding one letter per request. Returns
 * `null` on a malformed `%` escape so the caller can fail CLOSED: an
 * unparseable path is exactly the shape an evasion attempt produces, so
 * treating it as "not rate-limited" would recreate the same hole this fixes.
 */
function decodedForRouting(pathname: string): string | null {
  try {
    return decodeURIComponent(pathname);
  } catch {
    return null;
  }
}

/** BYOK routes match by prefix, not an exact list — every route under
 * /v1/byok/ is an outbound relay by construction (P2-5). */
export function isAuthRateLimited(pathname: string): boolean {
  const decoded = decodedForRouting(pathname);
  if (decoded === null) return true;
  const normalized = normalizeV1Path(decoded);
  return AUTH_RATE_LIMITED_EXACT.includes(normalized) || normalized.startsWith(AUTH_RATE_LIMITED_PREFIX);
}

/**
 * Forward an authenticated /v1 request, first spending one unit of that
 * identity's per-identity limiter when the path is cost-bearing. The key is
 * the worker-verified user id only (never a header the caller controls), and
 * the check fails open on a guard outage, matching the anonymous path's
 * contract.
 */
async function authenticatedForward(
  env: Env, request: Request, auth: { userId: string; userType: string }, pathname: string,
): Promise<Response> {
  if (!isAuthRateLimited(pathname)) return forwardV1(env, request, auth);
  const key = authenticatedRateLimitKey(auth.userId);
  const config = authRateLimitConfigFrom(env);
  const limit = await checkRateLimit(env.EDGE_GUARD, key, config);
  if (limit !== null && !limit.allowed) return rateLimitedResponse(limit.retryAfterSeconds);
  return forwardV1(env, request, auth);
}

// ── Anonymous /v1 access (issue #274 / S1.8) ───────────────────────────────
//
// The gate is no longer "authenticated or 401": on the anonymous allowlist an
// unauthenticated caller is given a worker-minted identity and forwarded with
// `X-User-Type: anonymous`, subject to a per-identity burst limit and the
// global daily-budget breaker. Everything else still 401s. Keep the allowlist
// narrow — each entry is a surface that costs money without a login.
// Photo-search (issue #260) is anon-metered by design: the container reads the
// worker-asserted X-User-Id/Type for its quota tiering, so both endpoints ride
// the same minted-identity + rate-limit + budget gate as /v1/chat.
const ANON_V1 = ["/v1/chat", "/v1/photo-search", "/v1/photo-search/confirm"];
const RATE_LIMIT_MESSAGE = "リクエストが多いみたい。少し待ってね。";

function isAnonymousV1(pathname: string): boolean {
  return ANON_V1.includes(pathname);
}

function rateLimitedResponse(retryAfterSeconds: number): Response {
  const error = { code: "rate_limited", message: RATE_LIMIT_MESSAGE, retry_after_seconds: retryAfterSeconds };
  return new Response(JSON.stringify({ error }), {
    status: 429,
    headers: { "Content-Type": "application/json", "Retry-After": String(retryAfterSeconds) },
  });
}

function withAnonymousCookie(response: Response, setCookie: string | null): Response {
  if (setCookie === null) return response;
  const headers = new Headers(response.headers);
  headers.append("Set-Cookie", setCookie);
  return new Response(response.body, { status: response.status, headers });
}

/** Normalize the container ingress's breaker rejection into the shared login
 * guidance, and latch it so the edge short-circuits for the rest of the day. */
async function guardBudget(env: Env, response: Response, dayKey: string): Promise<Response> {
  // Check the status BEFORE touching the body. `/v1/chat` answers with an SSE
  // StreamingResponse, so reading a clone waits for the container to finish the
  // whole turn — passing `await response.clone().text()` as an argument would
  // evaluate it on every response, including healthy 200s, and silently destroy
  // streaming for every anonymous turn (while buffering it twice in memory).
  if (response.status !== 403) return response;
  if (!isBudgetRejection(response.status, await response.clone().text())) return response;
  await latchBudget(env.EDGE_GUARD, dayKey);
  return budgetGuidanceResponse();
}

async function anonymousForward(
  env: Env, request: Request, identity: AnonymousIdentity, dayKey: string,
): Promise<Response> {
  if (await budgetLatched(env.EDGE_GUARD, dayKey)) return budgetGuidanceResponse();
  const forwarded = await forwardV1(env, request, { userId: identity.userId, userType: "anonymous" });
  return guardBudget(env, forwarded, dayKey);
}

/**
 * Mark this request as anonymously trusted and forward it, or return null when
 * anonymous access is not enabled (leaving the caller on the 401 path). The
 * limiter fails open — a guard outage must not take chat down — while the
 * budget breaker fails closed only on an explicit container verdict.
 *
 * Issue #447 arms the S1.9 Turnstile gate here, and the order is the point:
 *  - AFTER `resolveAnonymous`, so a challenge is only ever raised for a caller
 *    we would otherwise have served anonymously (anonymous access off still
 *    means 401, never 403);
 *  - BEFORE the limiter and the container, because the challenge is the outer
 *    wall. Cookie-only identity is free to reset, which resets the per-identity
 *    bucket with it; an unsolved turn must therefore cost neither a bucket slot
 *    (legitimate visitors would pay for their own challenges) nor an LLM call.
 */
export async function handleAnonymousV1(
  env: Env, request: Request, nowMs: number, gate: TurnstileGate,
): Promise<Response | null> {
  const identity = await resolveAnonymous(request, env);
  if (identity === null) return null;
  const challenged = await guardTurnstile(request, env, gate, identity.userId);
  if (challenged !== null) return challenged;
  const limit = await checkRateLimit(env.EDGE_GUARD, identity.userId, rateLimitConfigFrom(env));
  if (limit !== null && !limit.allowed) return rateLimitedResponse(limit.retryAfterSeconds);
  const response = await anonymousForward(env, request, identity, utcDayKey(nowMs));
  return withAnonymousCookie(response, identity.setCookie);
}

const UNAUTHORIZED_BODY = {
  error: { code: "unauthorized", message: "Valid credentials required." },
} as const;

/** Issue #537: with the OpenNext catch-all gone, an unmatched path has no
 * owner on this Worker. It answers a hard 404 in the same envelope as every
 * other edge rejection (`unauthorized`, `rate_limited`) so one client parser
 * covers the whole surface. Deliberately NOT a friendly 200 "this is an API
 * gateway" page: that is a soft-404 — crawlers index it and clients cannot
 * branch on it. Also reached via `c.notFound()` on the explicit
 * `/catalog/public/*` deny, keeping both paths on one shape. */
const NOT_FOUND_BODY = {
  error: { code: "not_found", message: "No route matches this request." },
} as const;

/** Structured, credential-free record of a rejected credential (issue #441).
 *
 * #441 itself only surfaced through anomalous anonymous spend. Its inverse — a
 * 401 storm from a mis-issued or mis-refreshed token — must not be equally
 * invisible, so every `invalid` verdict is counted at the edge. The token, the
 * header and the identity are deliberately absent from the record. */
function logInvalidCredential(pathname: string): void {
  console.warn(JSON.stringify({ event: "edge_auth_invalid_credential", path: pathname }));
}

function unauthorized(pathname: string): Response {
  logInvalidCredential(pathname);
  return Response.json(UNAUTHORIZED_BODY, { status: 401 });
}

// ── Session migration (issue #273 Task 3) ─────────────────────────
//
// The only route where the edge forwards a trusted X-Anon-Id: it resolves
// (never mints) the caller's `aid` cookie into the header the container
// re-validates.
//
// **The cookie is deliberately NOT retired afterwards (owner ruling, #507 —
// this REVERSES S1.7 rev5 P2-b; see the spec's "Decision reversal" note).**
// Retiring it minted a fresh `anon_<hex>` on the next anonymous turn, which
// reset the per-identity quota — so "exhaust the anonymous quota -> take the
// free magic link -> log out -> a brand-new anonymous allowance" became a loop
// the D12 quota banner itself walks the visitor into. Login-grants-quota is the
// conversion funnel working as intended and stays; the log-out-for-more leg
// converts nobody and teaches visitors not to stay signed in.
//
// rev5's privacy argument does not survive the migration it follows: once the
// UPDATE lands, that anonymous identity owns nothing — every `conversations`
// row is re-pointed at the account — so a shared browser's next visitor
// inherits an EMPTY identity. The only thing carried across is the day's quota
// count, which is precisely the effect being kept. (Clearing cookies or opening
// a private window still resets identity — `mintAnonymousIdentity` uses
// `crypto.randomUUID()` with no device binding. That path is unclosable by
// design and is not what this addresses.)
//
// Keeping the cookie also makes a failed migration recoverable: the anonymous
// identity, and the work it still owns, survive for a later retry.

const SESSION_MIGRATE_PATH = "/v1/session/migrate";

async function handleSessionMigrate(
  env: Env,
  request: Request,
  auth: { userId: string; userType: string },
): Promise<Response> {
  const identity = await resolveAnonymousReadOnly(request, env);
  return forwardV1(env, request, auth, identity?.userId ?? null);
}

/** Forward a container-originated catalog request to the private CATALOG binding
 * (in-datacenter hop, never the public internet). Wired as the container's
 * outboundByHost handler in entry.ts.
 *
 * This is one of two CATALOG call sites — `forwardPublicCatalog` above is the
 * other, serving the browser's one allowlisted GET. This one is the container's,
 * and it is deny-by-default: the container runs an LLM, so anything it can name
 * it can be talked into naming. */
export function catalogOutbound(request: Request, env: Env): Promise<Response> {
  if (!catalogRequestAllowed(request)) {
    const { pathname } = new URL(request.url);
    // Logged as an object, not a JSON string: Workers Logs only indexes fields
    // of structured entries, and filtering is the entire point of this line.
    console.warn({ event: "catalog_outbound_denied", method: request.method, pathname });
    return Promise.resolve(Response.json({ error: "catalog_request_forbidden" }, { status: 403 }));
  }
  return env.CATALOG.fetch(request);
}

/** Image proxy + cache for image.anitabi.cn (unchanged behaviour, ported from entry.js). */
async function handleImageProxy(request: Request, ctx: WorkerExecutionContext): Promise<Response> {
  const imagePath = new URL(request.url).pathname.slice(5);
  if (!imagePath || imagePath.includes("..")) return new Response("Bad request", { status: 400 });
  const cacheKey = new Request(request.url, request);
  const cached = await caches.default.match(cacheKey);
  if (cached) return cached;
  const upstream = await fetch(`https://image.anitabi.cn/${imagePath}`, {
    headers: { "User-Agent": "Animichi/1.0" },
  });
  if (!upstream.ok) {
    return new Response(upstream.body, {
      status: upstream.status,
      headers: { "Content-Type": upstream.headers.get("Content-Type") ?? "image/jpeg" },
    });
  }
  const headers = new Headers(upstream.headers);
  headers.set("Cache-Control", "public, max-age=604800, s-maxage=2592000");
  headers.set("Access-Control-Allow-Origin", "*");
  headers.delete("Set-Cookie");
  const response = new Response(upstream.body, { status: 200, headers });
  ctx.waitUntil(caches.default.put(cacheKey, response.clone()));
  return response;
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
