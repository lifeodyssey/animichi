import type { Context, Hono, MiddlewareHandler } from "hono";
import type { Env } from "../env.ts";
import { honoPath, withinTemplate } from "./path-template.ts";
import { gatewayFailure, recorded, type RequestClass } from "./request-record.ts";
import { notFoundResponse, showcaseDenied } from "./responses.ts";
import { GATEWAY_ROUTES, type GatewayRoute, type RouteCall } from "./route-table.ts";
import type { GatewayDeps } from "./route-services.ts";

/**
 * The gateway on Hono's router: each entry of `route-table.ts` is a framework
 * route, and Hono's `notFound` and `onError` answer what no entry
 * serves and what one throws, both in the shared JSON envelope rather than
 * Hono's plain-text defaults.
 *
 * Around each entry's service, in the order the gateway has always had: the
 * entry record, the showcase gate for every route but the landing assets, the
 * service itself, and the completion record.
 */

export interface GatewayEnv {
  Bindings: Env;
  Variables: { requestClass?: RequestClass };
}

export type GatewayApp = Hono<GatewayEnv>;
type GatewayContext = Context<GatewayEnv>;

/** The path routing matches: the pathname as the request spells it. Hono's
 * default `getPath` decodes it first (`decodeURI`), which would serve
 * `/v1/%63hat` as `/v1/chat`; the gateway has always matched the raw path. */
export function routingPath(request: Request): string {
  return new URL(request.url).pathname;
}

export function routeGateway(app: GatewayApp, gates: GatewayDeps): void {
  for (const route of GATEWAY_ROUTES) app.on(route.method, honoPath(route.template), routeHandler(route, gates));
  app.notFound((c) => answered(c, gates, "not-found", () => Promise.resolve(notFoundResponse())));
  app.onError((error, c) => gatewayFailure(error, c.get("requestClass") ?? "not-found"));
}

/** An entry answers a request it claims; one it passes on goes to the next
 * entry Hono matched, or to `notFound`, as if this entry never matched. */
function routeHandler(route: GatewayRoute, gates: GatewayDeps): MiddlewareHandler<GatewayEnv> {
  return async (c, next) => {
    if (claims(route, c)) return answered(c, gates, route.requestClass, () => route.serve(routeCall(c, gates, route)));
    await next();
  };
}

/** Hono dispatches a HEAD to every GET route, and `/x/*` also matches the bare
 * `/x`; neither was ever this gateway's route, so the entry passes them on. */
function claims(route: GatewayRoute, c: GatewayContext): boolean {
  if (route.method === "GET" && c.req.method !== "GET") return false;
  if (!withinTemplate(route.template, c.req.path)) return false;
  return route.accepts?.(c.req.path) ?? true;
}

function answered(
  c: GatewayContext, gates: GatewayDeps, requestClass: RequestClass, serve: () => Promise<Response>,
): Promise<Response> {
  c.set("requestClass", requestClass);
  return recorded(requestClass, c.req.raw, () => showcaseDenial(c, gates, requestClass) ?? serve());
}

/** Showcase mode denies every functional route (S0-v2 GOAL C): anything but the
 * landing assets and a path no route serves. */
function showcaseDenial(c: GatewayContext, gates: GatewayDeps, requestClass: RequestClass): Promise<Response> | null {
  if (requestClass === "landing" || requestClass === "not-found") return null;
  return gates.showcaseMode.isEnabled(c.env.EDGE_SHOWCASE_MODE) ? Promise.resolve(showcaseDenied()) : null;
}

function routeCall(c: GatewayContext, gates: GatewayDeps, route: GatewayRoute): RouteCall {
  return { env: c.env, request: c.req.raw, ctx: c.executionCtx, gates, route, path: c.req.path };
}
