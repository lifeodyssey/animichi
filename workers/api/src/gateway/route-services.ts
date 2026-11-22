/// <reference types="@cloudflare/workers-types" />

import { verifyAnonymousEntry } from "../identity/turnstile-entry.ts";
import { handleSessionAdopt, type SessionAdoptionStore } from "../identity/session-adopt.ts";
import { handleImageProxy } from "../proxy/image-proxy.ts";
import { handleTiles } from "../proxy/tiles.ts";
import type { ShowcaseMode } from "../proxy/showcase.ts";
import { unexpectedPublicCatalogQueryParam } from "@animichi/contract/public-catalog";
import { authenticatedRateLimitKey, authRateLimitConfigFrom } from "../protect/rate-limiter.ts";
import { guardPolicy } from "../protect/burst-guard.ts";
import { forwardPublicCatalog, forwardUsers } from "./forward.ts";
import { authenticationRejection, gatewayRejection, methodNotAllowed } from "./responses.ts";
import { publicReadKey } from "./read-key.ts";
import type { AgentTierGates } from "./agent-tier-route.ts";
import type { RouteCall } from "./route-table.ts";

// ── EDGE-1 #963: what serves each of the gateway's own routes ──────────────
//
// `route-table.ts` names one of these per entry; the agent tier's entries are
// served by `agent-tier-route.ts`. Each runs its route's gates in the order the
// route has always had: identity verification (Neon), the authenticated limiter
// on the entry's own rate cell, trusted internal-identity construction, and the
// forward to Catalog / Users or the in-process answer. The showcase gate and the
// request records run around them in `router.ts`.

/** The gates one app instance shares across every route it serves. */
export interface GatewayDeps extends AgentTierGates {
  showcaseMode: ShowcaseMode;
  sessionAdoption?: SessionAdoptionStore;
}

/** The readiness probe is this Worker's own answer (#1596): the CD smoke
 * (`staging-smoke-check.sh`) reads `GET /healthz` from the edge origin and
 * requires 200 with `status == "ok"`, so the deploy is judged by the gateway
 * that fronts it. It is the whole body. */
export function healthzResponse(): Promise<Response> {
  return Promise.resolve(Response.json({ status: "ok" }));
}

export function tilesResponse({ env, request, ctx }: RouteCall): Promise<Response> {
  return handleTiles(request, env.MAP_TILES, ctx);
}

export function imageResponse({ env, request, ctx }: RouteCall): Promise<Response> {
  return handleImageProxy(request, ctx, env.DOCS_ASSETS);
}

export async function publicCatalogResponse({ env, request, route }: RouteCall): Promise<Response> {
  const { pathname, searchParams } = new URL(request.url);
  if (unexpectedPublicCatalogQueryParam(pathname, [...searchParams.keys()]) !== null) {
    return gatewayRejection("unexpected_query", 400, "This route does not accept that query parameter.");
  }
  const guarded = await guardPolicy(env, route.rate, publicReadKey(request), authRateLimitConfigFrom(env));
  if (guarded !== null) return guarded;
  return forwardPublicCatalog(env, request);
}

export async function usersResponse({ env, request, ctx, gates, route }: RouteCall): Promise<Response> {
  const auth = await gates.authenticate(request, env, ctx);
  if (!auth.ok) return authenticationRejection(request, auth);
  // User-account mutations are an exact durable fail-closed write class
  // (AC2/AC4) and GET reads are unmanaged and never metered: the table gives the
  // users read and the users writes an entry each, and this meters by its cell.
  const guarded = await guardPolicy(env, route.rate, authenticatedRateLimitKey(auth.userId), authRateLimitConfigFrom(env));
  if (guarded !== null) return guarded;
  return forwardUsers(env, request, auth);
}

export async function adoptResponse({ env, request, ctx, gates, route }: RouteCall): Promise<Response> {
  if (request.method !== "POST") return methodNotAllowed();
  const auth = await gates.authenticate(request, env, ctx);
  if (!auth.ok) return authenticationRejection(request, auth);
  // Adoption is a state-migrating WRITE: its entry's cell is a durable
  // fail-closed mutation, so it rides the same `guardPolicy` seam.
  const guarded = await guardPolicy(env, route.rate, authenticatedRateLimitKey(auth.userId), authRateLimitConfigFrom(env));
  if (guarded !== null) return guarded;
  return handleSessionAdopt(env, request, auth, gates.sessionAdoption);
}

export async function turnstileVerifyResponse({ env, request, ctx, gates }: RouteCall): Promise<Response> {
  if (request.method !== "POST") return methodNotAllowed();
  const auth = await gates.authenticate(request, env, ctx);
  if (auth.ok) return new Response(null, { status: 204 });
  // Only an ABSENT credential may reach the anonymous entry (#441/#452); a
  // rejected one and one we could not check are both answered here.
  if (auth.reason !== "absent") return authenticationRejection(request, auth);
  return verifyAnonymousEntry(env, request, gates.turnstileGate);
}
