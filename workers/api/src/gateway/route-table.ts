import { AGENT_PATHS } from "@animichi/contract/agent-paths";
import { TURNSTILE_VERIFY_PATH } from "@animichi/contract/constants";
import { USERS_BINDING_PREFIX } from "@animichi/contract/internal-binding";
import { isPublicCatalogPath, PUBLIC_CATALOG_ROUTES, type PublicCatalogRoute } from "@animichi/contract/public-catalog";
import type { Env, WorkerExecutionContext } from "../env.ts";
import { SESSION_ADOPT_PATH } from "../identity/session-adopt.ts";
import { agentTierResponse, sessionTierResponse } from "./agent-tier-route.ts";
import {
  DURABLE_ADOPT, DURABLE_BYOK, DURABLE_HIGH_COST, DURABLE_USER_MUTATION, NATIVE_PUBLIC_READ, UNMANAGED_READ, type RatePolicy,
} from "./rate-policy.ts";
import type { RequestClass } from "./request-record.ts";
import { notFoundResponse } from "./responses.ts";
import {
  adoptResponse, healthzResponse, imageResponse, publicCatalogResponse, tilesResponse, turnstileVerifyResponse, usersResponse,
  type GatewayDeps,
} from "./route-services.ts";

/**
 * Every route the gateway serves, declared once; Hono does the routing.
 * `router.ts` hands each entry to Hono as a framework route, and the same
 * entry names the rate cell its limiter call meters by, so routing and rate
 * classification read one table and cannot drift apart. A path no entry matches
 * is the shared 404 envelope.
 *
 * Hono runs every entry whose template matches, in this order, and the first
 * that claims the request answers it. A GET entry answers a HEAD too: Hono
 * dispatches a HEAD to the GET routes, and `router.ts` answers it with the GET
 * answer's status and headers and no body. A namespace passes on its bare name,
 * and `accepts` passes on a path the template matched but the route refuses. So
 * order only matters where templates overlap: the users read before the users
 * writes, and the `/v1/*` fallback last.
 */

/** The methods an entry answers. A GET entry also answers HEAD, as its GET. */
export type RouteMethod = "GET" | "POST" | "ALL";

/** One request an entry answers, with everything its service reads. */
export interface RouteCall {
  readonly env: Env;
  readonly request: Request;
  readonly ctx: WorkerExecutionContext;
  readonly gates: GatewayDeps;
  readonly route: GatewayRoute;
  /** The path as the request spells it, escapes and all: what routing matched. */
  readonly path: string;
}

export interface GatewayRoute {
  readonly method: RouteMethod;
  /** The path in the inventories' form (`path-template.ts`). */
  readonly template: string;
  /** What the request records call a request this entry answered. */
  readonly requestClass: RequestClass;
  /** The rate cell this entry's limiter call meters by (`rate-policy.ts`). */
  readonly rate: RatePolicy;
  /** False for a path the template matched that this entry still refuses. */
  readonly accepts?: (path: string) => boolean;
  readonly serve: (call: RouteCall) => Promise<Response>;
}

/** Require an entry's path to exist in the Agent inventory (CONTRACT-1 #938)
 * before it can match: an entry the inventory no longer carries — a route
 * retired by a later card — fails module load, so a retired path can never
 * silently stay served. */
function inventoryPath(path: string): string {
  if (AGENT_PATHS.some((entry) => entry.path === path)) return path;
  throw new Error(`route table entry "${path}" is not in the AGENT_PATHS inventory`);
}

function tierRoute(method: RouteMethod, path: string, rate: RatePolicy, serve: GatewayRoute["serve"]): GatewayRoute {
  return { method, template: inventoryPath(path), requestClass: "v1", rate, serve };
}

/** The native agent tier's routes (W1-7 #1256): always served by this Worker. */
export const AGENT_TIER_ROUTES: readonly GatewayRoute[] = [
  tierRoute("POST", "/v1/chat", DURABLE_HIGH_COST, (call) => agentTierResponse(call, { kind: "turn" })),
  tierRoute("POST", "/v1/byok/probe", DURABLE_BYOK, (call) => agentTierResponse(call, { kind: "probe" })),
  tierRoute("GET", "/v1/conversations", UNMANAGED_READ, (call) => agentTierResponse(call, { kind: "list" })),
  tierRoute("GET", "/v1/conversations/{session_id}/messages", UNMANAGED_READ, (call) => sessionTierResponse(call, "transcript")),
  tierRoute("GET", "/v1/conversations/{session_id}/stream", UNMANAGED_READ, (call) => sessionTierResponse(call, "stream")),
];

/** One read of the public catalog surface, which `@animichi/contract/public-catalog`
 * declares for this gateway and the catalog Worker alike (#1691). Its matcher is
 * the entry's `accepts`, so an id outside the declared grammar (`bangumi_id` is
 * digits) is no catalog read. */
function publicCatalogRoute(route: PublicCatalogRoute): GatewayRoute {
  return {
    method: "GET", template: route.template, requestClass: "public-catalog", rate: NATIVE_PUBLIC_READ,
    accepts: isPublicCatalogPath, serve: publicCatalogResponse,
  };
}

/** The legacy anonymous-session migration path deleted with AdoptSessions
 * (SESSION-2 #960). Kept as its own entry so no request can ever be forwarded to
 * a route that no longer exists, and so the records still name it. */
const SESSION_MIGRATE_PATH = "/v1/session/migrate";

const USERS_NAMESPACE = `${USERS_BINDING_PREFIX}*`;

function notFound(): Promise<Response> {
  return Promise.resolve(notFoundResponse());
}

export const GATEWAY_ROUTES: readonly GatewayRoute[] = [
  { method: "GET", template: "/healthz", requestClass: "landing", rate: UNMANAGED_READ, serve: healthzResponse },
  { method: "ALL", template: "/tiles/*", requestClass: "landing", rate: UNMANAGED_READ, serve: tilesResponse },
  { method: "ALL", template: "/img/*", requestClass: "landing", rate: UNMANAGED_READ, serve: imageResponse },
  ...PUBLIC_CATALOG_ROUTES.map(publicCatalogRoute),
  { method: "ALL", template: SESSION_MIGRATE_PATH, requestClass: "retired", rate: UNMANAGED_READ, serve: notFound },
  { method: "GET", template: USERS_NAMESPACE, requestClass: "users", rate: UNMANAGED_READ, serve: usersResponse },
  { method: "ALL", template: USERS_NAMESPACE, requestClass: "users", rate: DURABLE_USER_MUTATION, serve: usersResponse },
  { method: "ALL", template: SESSION_ADOPT_PATH, requestClass: "adopt", rate: DURABLE_ADOPT, serve: adoptResponse },
  { method: "ALL", template: TURNSTILE_VERIFY_PATH, requestClass: "v1", rate: UNMANAGED_READ, serve: turnstileVerifyResponse },
  ...AGENT_TIER_ROUTES,
  // #1605: a `/v1` path nothing above serves — a method mismatch on a tier
  // route (`GET /v1/chat`) or a path no document advertises — is the shared
  // 404 without touching identity, the limiter, Turnstile or the budget latch:
  // a route that cannot be served must not spend a caller's challenge or a
  // bucket slot to say so. It is still a `/v1` path, so showcase mode denies it
  // like any other.
  { method: "ALL", template: "/v1/*", requestClass: "v1", rate: UNMANAGED_READ, serve: notFound },
];
