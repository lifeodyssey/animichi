/// <reference types="@cloudflare/workers-types" />
import { Hono } from "hono";
import {
  type AnonymousIdentity,
  type AuthResult,
  authenticate as realAuthenticate,
  resolveAnonymous,
} from "./auth.ts";
import {
  budgetGuidanceResponse,
  budgetLatched,
  isBudgetRejection,
  latchBudget,
  utcDayKey,
} from "./costBreaker.ts";
import type { GuardNamespace } from "./guardStore.ts";
import { checkRateLimit, rateLimitConfigFrom } from "./rateLimiter.ts";

export interface Env {
  CATALOG: { fetch: (req: Request) => Promise<Response> };
  USERS: { fetch: (req: Request) => Promise<Response> };
  CONTAINER: DurableObjectNamespace;
  EDGE_GUARD: GuardNamespace;
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  /** Cloudflare Turnstile secret (Worker secret binding — never process.env). */
  TURNSTILE_SECRET: string;
  ANON_ACCESS_ENABLED?: string;
  ANON_ID_SECRET?: string;
  [key: string]: unknown;
}

interface NextHandler {
  fetch: (req: Request, env: unknown, ctx: WorkerExecutionContext) => Promise<Response>;
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
 * client-supplied X-User-* (anti-forgery); on authed paths also strips
 * Authorization and injects the worker-verified identity. */
function forwardV1(env: Env, request: Request, auth?: { userId: string; userType: string }): Promise<Response> {
  const headers = new Headers(request.headers);
  headers.delete("X-User-Id");
  headers.delete("X-User-Type");
  if (auth) {
    headers.delete("Authorization");
    headers.set("X-User-Id", auth.userId);
    headers.set("X-User-Type", auth.userType);
  }
  const forwarded = new Request(request, { headers });
  return env.CONTAINER.get(env.CONTAINER.idFromName("default")).fetch(forwarded);
}

// ── Anonymous /v1 access (issue #274 / S1.8) ───────────────────────────────
//
// The gate is no longer "authenticated or 401": on the anonymous allowlist an
// unauthenticated caller is given a worker-minted identity and forwarded with
// `X-User-Type: anonymous`, subject to a per-identity burst limit and the
// global daily-budget breaker. Everything else still 401s. Keep the allowlist
// narrow — each entry is a surface that costs money without a login.
const ANON_V1 = ["/v1/chat"];
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
 */
export async function handleAnonymousV1(
  env: Env, request: Request, nowMs: number,
): Promise<Response | null> {
  const identity = await resolveAnonymous(request, env);
  if (identity === null) return null;
  const limit = await checkRateLimit(env.EDGE_GUARD, identity.userId, rateLimitConfigFrom(env));
  if (limit !== null && !limit.allowed) return rateLimitedResponse(limit.retryAfterSeconds);
  const response = await anonymousForward(env, request, identity, utcDayKey(nowMs));
  return withAnonymousCookie(response, identity.setCookie);
}

/** Forward a container-originated catalog request to the private CATALOG binding
 * (in-datacenter hop, never the public internet). Wired as the container's
 * outboundByHost handler in entry.ts. */
export function catalogOutbound(request: Request, env: Env): Promise<Response> {
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

/** The main Worker app. NOTE: no /catalog/* route — catalog is private (reached
 * only via the container outboundByHost binding, never the public internet). */
export function createWorkerApp(deps: {
  nextHandler: NextHandler;
  authenticate?: (request: Request, env: Env, ctx: WorkerExecutionContext) => Promise<AuthResult>;
}): Hono<{ Bindings: Env }> {
  const app = new Hono<{ Bindings: Env }>();
  const authenticate = deps.authenticate ?? ((req, env, ctx) => realAuthenticate(req, env, fetch, ctx));
  app.get("/healthz", (c) =>
    c.env.CONTAINER.get(c.env.CONTAINER.idFromName("default")).fetch(c.req.raw),
  );
  app.all("/img/*", (c) => handleImageProxy(c.req.raw, c.executionCtx));
  app.get("/catalog/public/anime-overview/:bangumiId{[0-9]+}", (c) => {
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
      return forwardV1(c.env, c.req.raw, { userId: auth.userId, userType: auth.userType });
    }
    // S1.9 Turnstile (issue #281) is MERGED but still DORMANT: the gate lives in
    // ./turnstile.ts and nothing below calls it. This branch — anonymous access
    // (#274) — is the surface it was written to guard, and it ships
    // ANON_ACCESS_ENABLED="false" in production precisely because until the gate
    // is armed, dropping the `aid` cookie mints a fresh identity and resets the
    // per-identity limiter, leaving the daily dollar breaker as the only guard.
    // To arm it, wrap the anonymous branch:
    //   const denied = await guardTurnstile(c.req.raw, c.env, turnstileGate);
    //   if (denied !== null) return denied;
    // (`turnstileGate` = module-level createTurnstileGate() from ./turnstile.ts,
    // so its short-lived window is shared across requests on the same isolate.)
    const anonymous = isAnonymousV1(pathname)
      ? await handleAnonymousV1(c.env, c.req.raw, Date.now())
      : null;
    if (anonymous !== null) return anonymous;
    return c.json({ error: { code: "unauthorized", message: "Valid credentials required." } }, 401);
  });
  app.all("*", (c) => deps.nextHandler.fetch(c.req.raw, c.env, c.executionCtx));
  return app;
}
