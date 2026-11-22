import type { Env } from "../env.ts";
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
 *
 * #1605 removed the only forward that could reach an outside service: the
 * container forward, its cold-start retry and the container's `catalog.internal`
 * interception are gone, and the agent surface is served in process by the
 * native tier (`gateway/agent-tier-route.ts`). What is left in this module is
 * this forward and `forwardPublicCatalog`, both straight service-binding hops.
 */
export function forwardUsers(env: Env, request: Request, auth: { userId: string; userType: string }): Promise<Response> {
  const headers = new Headers(request.headers);
  stripUntrustedHeaders(headers);
  applyIdentity(headers, auth);
  return env.USERS.fetch(new Request(request, { headers }));
}
