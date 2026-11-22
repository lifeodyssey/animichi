// Hono assembly only: it wires the concern folders together and holds no logic
// of its own.
import { Hono } from "hono";
import type { Env, WorkerExecutionContext } from "./env.ts";
import type { AuthResult } from "./identity/auth.ts";
import { authenticate as realAuthenticate } from "./identity/auth.ts";
import type { GatewayDeps } from "./gateway/route-services.ts";
import { routeGateway, routingPath, type GatewayApp, type GatewayEnv } from "./gateway/router.ts";
import { createTurnstileGate, type TurnstileGate } from "./protect/turnstile.ts";
import { createShowcaseMode, type ShowcaseMode } from "./proxy/showcase.ts";
import { neonAgentTurnTier, type AgentTurnTier } from "./gateway/agent-turn.ts";
import { requestIdScope } from "./gateway/request-id.ts";
import type { SessionAdoptionStore } from "./identity/session-adopt.ts";

/** The main Worker app: a pure API and asset gateway. Every route it serves —
 * `/healthz`, the image and private R2 tile proxies, the allowlisted public
 * catalog reads, and the whole `/v1` surface — is a Hono route declared once in
 * `gateway/route-table.ts` and mounted by `gateway/router.ts`, which owns the
 * records, the showcase gate and the shared envelopes around them.
 *
 * Issue #537 removed the OpenNext catch-all that used to render the legacy
 * Next.js homepage here; `apps/web` owns every HTML surface now. Unmatched
 * paths answer `notFoundResponse()` instead of a page — see its comment for why
 * that is a hard 404 and not a friendly 200. */

export interface WorkerDeps {
  authenticate?: (request: Request, env: Env, ctx: WorkerExecutionContext) => Promise<AuthResult>;
  turnstileGate?: TurnstileGate;
  /** Injectable showcase gate (tests capture its warning / isolate it per case). */
  showcaseMode?: ShowcaseMode;
  /** Injectable agent tier (W1-7 #1256): the production one opens a Neon pool
   * and two Durable Object stubs, so tests substitute it to stay hermetic. */
  agentTurns?: AgentTurnTier;
  sessionAdoption?: SessionAdoptionStore;
}

function resolveGates(deps: WorkerDeps): GatewayDeps {
  // One gate per app instance, built outside the request handlers so their
  // pass window / warn-once dedupe is shared by every request on the same
  // isolate — tests inject their own to keep state out of module scope.
  return {
    authenticate: deps.authenticate ?? ((req, env, ctx) => realAuthenticate(req, env, fetch, ctx)),
    turnstileGate: deps.turnstileGate ?? createTurnstileGate(),
    showcaseMode: deps.showcaseMode ?? createShowcaseMode(),
    agentTurns: deps.agentTurns ?? neonAgentTurnTier(),
    sessionAdoption: deps.sessionAdoption,
  };
}

export function createWorkerApp(deps: WorkerDeps): GatewayApp {
  const app = new Hono<GatewayEnv>({ getPath: routingPath });
  // Outermost, so the request ID scopes every route below it, `onError` included.
  app.use("*", requestIdScope);
  routeGateway(app, resolveGates(deps));
  return app;
}
