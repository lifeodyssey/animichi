import { catalogRequestAllowed } from "./catalog-policy.ts";
import type { Env } from "../env.ts";
import { authenticatedRateLimitKey, authRateLimitConfigFrom } from "../protect/rate-limiter.ts";
import { guardPolicy } from "../protect/burst-guard.ts";
import { classifyRatePolicy } from "./rate-policy.ts";
import { fetchContainerResilient } from "./container-fetch.ts";
import { gatewayRejection } from "./responses.ts";
import { AUTHORIZATION_HEADER, USER_IDENTITY_HEADER, USER_TYPE_HEADER } from "@animichi/contract/internal-binding";

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
  headers.delete(AUTHORIZATION_HEADER);
  headers.set(USER_IDENTITY_HEADER, auth.userId);
  headers.set(USER_TYPE_HEADER, auth.userType);
}

/** Client-supplied identity headers are anti-forgery: always stripped. */
function stripUntrustedHeaders(headers: Headers): void {
  headers.delete(AUTHORIZATION_HEADER);
  headers.delete(USER_IDENTITY_HEADER);
  headers.delete(USER_TYPE_HEADER);
  headers.delete("x-byok-endpoint");
  headers.delete("X-Anon-Id");
}

/** Forward a /v1 request to the container's default instance. Always strips
 * Authorization, client-supplied X-User-*, X-Anon-Id (anti-forgery), and x-byok-endpoint
 * (documented as trusted by the container but client-settable — closed
 * until BYOK launches); on authed paths it injects the worker-verified identity.
 * A trusted `X-Anon-Id` is set only
 * when the caller passes one explicitly (the session-adoption route,
 * SESSION-2 #960 / re-P2-1) — every other route forwards none. `x-session-id` is
 * intentionally forwarded: chat session continuity needs it, so the
 * container must never treat it as a trust signal.
 *
 * The fetch itself rides `fetchContainerResilient` (issue #1220): the
 * cold-start startup retry `/healthz` already had, plus a 60s head-of-response
 * timeout — see `gateway/container-fetch.ts`, which the two landing forwards
 * joined in EG-21 (#1343). `sleep` is threaded down from
 * `GatewayDeps` so tests can drive the retry's backoff without real waits. */
export function forwardV1(
  env: Env,
  request: Request,
  auth: { userId: string; userType: string } | undefined,
  trustedAnonId: string | null | undefined,
  sleep: (ms: number) => Promise<void>,
): Promise<Response> {
  const headers = new Headers(request.headers);
  stripUntrustedHeaders(headers);
  if (auth) applyIdentity(headers, auth);
  if (trustedAnonId) headers.set("X-Anon-Id", trustedAnonId);
  const forwarded = new Request(request, { headers });
  const container = env.CONTAINER.get(env.CONTAINER.idFromName("default"));
  return fetchContainerResilient((inner) => container.fetch(inner), forwarded, sleep);
}

/**
 * Forward an authenticated /v1 request, spending one unit of that identity's
 * limiter exactly when the route policy puts the op in a guarded cell. One
 * decision path (issue #680 review REJECT): this route classifies the request
 * with `classifyRatePolicy` and delegates to `guardPolicy`, so a
 * durable cell (high-cost/write/BYOK) FAILS CLOSED on outage (AC4 — an
 * unmeterable turn must not run), a native cell fails open + alerts, and an
 * unmanaged read is forwarded without touching a binding. The key is the
 * worker-verified user id only (never a header the caller controls).
 */
export async function authenticatedForward(
  env: Env, request: Request, auth: { userId: string; userType: string }, pathname: string,
  sleep: (ms: number) => Promise<void>,
): Promise<Response> {
  const guarded = await guardPolicy(
    env, classifyRatePolicy(request.method, pathname), authenticatedRateLimitKey(auth.userId), authRateLimitConfigFrom(env),
  );
  if (guarded !== null) return guarded;
  return forwardV1(env, request, auth, undefined, sleep);
}

/**
 * Forward an authenticated /v1/users/* request to the USERS service binding.
 *
 * AUTH-2 #950: the edge verifies the Neon bearer itself (verifyNeonIdentity)
 * and the users service trusts only the worker-verified identity — this is the
 * internal boundary. `applyIdentity` strips `Authorization` and injects
 * `X-User-Id`/`X-User-Type`; `stripUntrustedHeaders` removes any forged
 * caller-supplied identity headers first, so a client can never name a user_id
 * the edge did not verify. Restoring raw bearer forwarding is the rollback
 * mutation pinned by entry-v1-routing.test.ts.
 */
export function forwardUsers(env: Env, request: Request, auth: { userId: string; userType: string }): Promise<Response> {
  const headers = new Headers(request.headers);
  stripUntrustedHeaders(headers);
  applyIdentity(headers, auth);
  return env.USERS.fetch(new Request(request, { headers }));
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
    return Promise.resolve(gatewayRejection("catalog_request_forbidden", 403, "This catalog route is not one the container may call."));
  }
  return env.CATALOG.fetch(request);
}
