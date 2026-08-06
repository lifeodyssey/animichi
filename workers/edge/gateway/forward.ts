import { catalogRequestAllowed } from "./catalog-policy.ts";
import type { Env } from "../env.ts";
import { authenticatedRateLimitKey, authRateLimitConfigFrom, checkRateLimit } from "../protect/rate-limiter.ts";
import { rateLimitedResponse } from "../responses.ts";
import { isAuthRateLimited } from "../routing-policy.ts";

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
export function forwardPublicCatalog(env: Env, request: Request): Promise<Response> {
  return env.CATALOG.fetch(new Request(request, { headers: publicCatalogHeaders(request) }));
}

/** The worker-verified identity replaces the caller's own headers. */
function applyIdentity(headers: Headers, auth: { userId: string; userType: string }): void {
  headers.delete("Authorization");
  headers.set("X-User-Id", auth.userId);
  headers.set("X-User-Type", auth.userType);
}

/** Client-supplied identity headers are anti-forgery: always stripped. */
function stripUntrustedHeaders(headers: Headers): void {
  headers.delete("X-User-Id");
  headers.delete("X-User-Type");
  headers.delete("x-byok-endpoint");
  headers.delete("X-Anon-Id");
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
export function forwardV1(
  env: Env, request: Request, auth?: { userId: string; userType: string }, trustedAnonId?: string | null,
): Promise<Response> {
  const headers = new Headers(request.headers);
  stripUntrustedHeaders(headers);
  if (auth) applyIdentity(headers, auth);
  if (trustedAnonId) headers.set("X-Anon-Id", trustedAnonId);
  const forwarded = new Request(request, { headers });
  return env.CONTAINER.get(env.CONTAINER.idFromName("default")).fetch(forwarded);
}

/**
 * Forward an authenticated /v1 request, first spending one unit of that
 * identity's per-identity limiter when the path is cost-bearing. The key is
 * the worker-verified user id only (never a header the caller controls), and
 * the check fails open on a guard outage, matching the anonymous path's
 * contract.
 */
export async function authenticatedForward(
  env: Env, request: Request, auth: { userId: string; userType: string }, pathname: string,
): Promise<Response> {
  if (!isAuthRateLimited(pathname)) return forwardV1(env, request, auth);
  const key = authenticatedRateLimitKey(auth.userId);
  const config = authRateLimitConfigFrom(env);
  const limit = await checkRateLimit(env.EDGE_GUARD, key, config);
  if (limit !== null && !limit.allowed) return rateLimitedResponse(limit.retryAfterSeconds);
  return forwardV1(env, request, auth);
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
