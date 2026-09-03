// W0-S1 (#1244) + W0-S2 (#1245) + W0-S4 (#1247) + W0-S5 (#1248): entry point of
// the throwaway probe Worker `animichi-spike-pi`. It is NOT the production edge —
// nothing under `workers/edge/src/` imports anything from this directory, and this
// Worker carries no identity, rate-limit or routing surface.
//
// Three tiers, in this order: routes this Worker answers itself
// (`localResponse` — healthz, S2's `/compat`, S5's three egress probes), then
// S4's `DurableTurnSession`, then S1's `PiTurnSession`, then a 404. S2 and S5
// need no Durable Object: both measure the round trip the caller is waiting on,
// so their answers belong to the same request.

import { DurableTurnSession } from "./durable-turn-session.ts";
import { EgressProbe } from "./egress-probe.ts";
import { parseEgressProbeCommand } from "./egress-probe-command.ts";
import { MimoDialectProbe } from "./mimo-dialect-probe.ts";
import { probePlatformEgress } from "./platform-egress-probe.ts";
import { probeRedirectFixture } from "./redirect-fixture-probe.ts";
import {
  configuredMimoRoutes,
  configuredProviders,
  type ProviderKeys,
} from "./spike-models.ts";
import { databaseConfigured, type SpikeDatabaseKeys } from "./spike-database.ts";
import { isSessionRoute, routeOf, type SpikeRoute } from "./spike-routes.ts";
import { PiTurnSession } from "./turn-session.ts";

export { DurableTurnSession, PiTurnSession };

export interface SpikeEnv extends ProviderKeys, SpikeDatabaseKeys {
  PI_TURN: DurableObjectNamespace;
  PI_DURABLE: DurableObjectNamespace;
}

/** The routes `DurableTurnSession` serves; S1's session takes `isSessionRoute`. */
const DURABLE_ROUTES: readonly SpikeRoute[] = ["turn_long", "run_status"];

function healthResponse(env: SpikeEnv): Response {
  return Response.json({
    ok: true,
    worker: "animichi-spike-pi",
    providers: configuredProviders(env),
    database: databaseConfigured(env),
    mimoRoutes: configuredMimoRoutes(env),
  });
}

async function jsonBodyOf(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

/** W0-S5 (#1248): one red-line row, decided and — when allowed — actually run. */
async function egressResponse(request: Request): Promise<Response> {
  const parsed = parseEgressProbeCommand(await jsonBodyOf(request));
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });
  return Response.json(await new EgressProbe().run(parsed.command));
}

async function platformEgressResponse(): Promise<Response> {
  return Response.json({ probes: await probePlatformEgress() });
}

async function redirectEgressResponse(): Promise<Response> {
  return Response.json({ probes: await probeRedirectFixture() });
}

function sessionNameOf(url: URL, fallback: string): string {
  return url.searchParams.get("session") ?? fallback;
}

function sessionFor(namespace: DurableObjectNamespace, name: string) {
  return namespace.get(namespace.idFromName(name));
}

/** The routes this Worker answers itself; `null` means a Durable Object owns it. */
function localResponse(
  route: SpikeRoute,
  request: Request,
  env: SpikeEnv,
): Promise<Response> | Response | null {
  if (route === "healthz") return healthResponse(env);
  if (route === "compat") return new MimoDialectProbe(env, Date.now).respond(request);
  if (route === "egress") return egressResponse(request);
  if (route === "egress_platform") return platformEgressResponse();
  if (route === "egress_redirect") return redirectEgressResponse();
  return null;
}

export default {
  fetch(request: Request, env: SpikeEnv): Promise<Response> | Response {
    const url = new URL(request.url);
    const route = routeOf(request.method, url.pathname);
    const local = localResponse(route, request, env);
    if (local !== null) return local;
    if (DURABLE_ROUTES.includes(route)) {
      return sessionFor(env.PI_DURABLE, sessionNameOf(url, "s4")).fetch(request);
    }
    if (isSessionRoute(route)) {
      return sessionFor(env.PI_TURN, sessionNameOf(url, "s1")).fetch(request);
    }
    return Response.json({ error: "not found" }, { status: 404 });
  },
};
