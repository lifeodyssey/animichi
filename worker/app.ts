/// <reference types="@cloudflare/workers-types" />
import { Hono } from "hono";
import { authenticate as realAuthenticate, type AuthResult } from "./auth.ts";

export interface Env {
  CATALOG: { fetch: (req: Request) => Promise<Response> };
  CONTAINER: DurableObjectNamespace;
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  [key: string]: unknown;
}

interface NextHandler {
  fetch: (req: Request, env: unknown, ctx: ExecutionContext) => Promise<Response>;
}

const PUBLIC_V1 = ["/v1/search/preview", "/v1/bangumi/popular"];
function isPublicV1(pathname: string): boolean {
  return PUBLIC_V1.includes(pathname) || /^\/v1\/bangumi\/[^/]+\/guide$/.test(pathname);
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

/** Forward a container-originated catalog request to the private CATALOG binding
 * (in-datacenter hop, never the public internet). Wired as the container's
 * outboundByHost handler in entry.ts. */
export function catalogOutbound(request: Request, env: Env): Promise<Response> {
  return env.CATALOG.fetch(request);
}

/** Image proxy + cache for image.anitabi.cn (unchanged behaviour, ported from entry.js). */
async function handleImageProxy(request: Request, ctx: ExecutionContext): Promise<Response> {
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
      headers: { "Content-Type": upstream.headers.get("Content-Type") || "image/jpeg" },
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
  authenticate?: (request: Request, env: Env, ctx: ExecutionContext) => Promise<AuthResult>;
}): Hono<{ Bindings: Env }> {
  const app = new Hono<{ Bindings: Env }>();
  const authenticate = deps.authenticate ?? ((req, env, ctx) => realAuthenticate(req, env, fetch, ctx));
  app.get("/healthz", (c) =>
    c.env.CONTAINER.get(c.env.CONTAINER.idFromName("default")).fetch(c.req.raw),
  );
  app.all("/img/*", (c) => handleImageProxy(c.req.raw, c.executionCtx));
  app.all("/v1/*", async (c) => {
    if (isPublicV1(new URL(c.req.url).pathname)) return forwardV1(c.env, c.req.raw);
    const auth = await authenticate(c.req.raw, c.env, c.executionCtx);
    if (!auth.ok) {
      return c.json({ error: { code: "unauthorized", message: "Valid credentials required." } }, 401);
    }
    return forwardV1(c.env, c.req.raw, { userId: auth.userId, userType: auth.userType });
  });
  app.all("*", (c) => deps.nextHandler.fetch(c.req.raw, c.env, c.executionCtx));
  return app;
}
