// TODO(#841 path-delta): composition root — stays at the worker root until the
// #853 package-ization; all logic lives in identity/ gateway/ protect/ proxy/
// container/.
import { Hono } from "hono";
import type { Env, WorkerExecutionContext } from "./env.ts";
import type { AuthResult } from "./identity/auth.ts";
import { authenticate as realAuthenticate } from "./identity/auth.ts";
import { HandleGatewayRequest, type GatewayDeps } from "./gateway/request.ts";
import { defaultStagingGateExchange } from "./staging-gate/exchange.ts";
import { createTurnstileGate, type TurnstileGate } from "./protect/turnstile.ts";
import { createShowcaseMode, type ShowcaseMode } from "./proxy/showcase.ts";

/** The main Worker app: a pure API and asset gateway. Every request —
 * `/healthz`, the image and private R2 tile proxies, the one allowlisted
 * public catalog read, and the whole `/v1` surface — is delegated to the
 * composed gateway seam (HandleGatewayRequest), which owns route selection,
 * identity, protection, internal-identity construction, and forwarding.
 *
 * Issue #537 removed the OpenNext catch-all that used to render the legacy
 * Next.js homepage here; `apps/web` owns every HTML surface now. Unmatched
 * paths answer `NOT_FOUND_BODY` instead of a page — see its comment for why
 * that is a hard 404 and not a friendly 200. */

type WorkerApp = Hono<{ Bindings: Env }>;

export interface WorkerDeps {
  authenticate?: (request: Request, env: Env, ctx: WorkerExecutionContext) => Promise<AuthResult>;
  turnstileGate?: TurnstileGate;
  /** Injectable sleep for the container cold-start retry (tests avoid real waits). */
  sleep?: (ms: number) => Promise<void>;
  /** Injectable showcase gate (tests capture its warning / isolate it per case). */
  showcaseMode?: ShowcaseMode;
  /** Injectable staging-gate OIDC exchange (CI channel, #1054); tests substitute
   * it to avoid hitting GitHub's remote JWKS. */
  stagingGateExchange?: (request: Request, env: Env) => Promise<Response>;
}

function realSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resolveGates(deps: WorkerDeps): GatewayDeps {
  // One gate per app instance, built outside the request handlers so their
  // pass window / warn-once dedupe is shared by every request on the same
  // isolate — tests inject their own to keep state out of module scope.
  return {
    authenticate: deps.authenticate ?? ((req, env, ctx) => realAuthenticate(req, env, fetch, ctx)),
    turnstileGate: deps.turnstileGate ?? createTurnstileGate(),
    showcaseMode: deps.showcaseMode ?? createShowcaseMode(),
    sleep: deps.sleep ?? realSleep,
    stagingGateExchange: deps.stagingGateExchange ?? defaultStagingGateExchange,
  };
}

export function createWorkerApp(deps: WorkerDeps): WorkerApp {
  const app = new Hono<{ Bindings: Env }>();
  const gates = resolveGates(deps);
  app.all("*", (c) => HandleGatewayRequest(c.env, c.req.raw, c.executionCtx, gates));
  return app;
}
