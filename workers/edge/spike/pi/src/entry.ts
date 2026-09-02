// W0-S1 spike (#1244) + W0-S4 spike (#1247): entry point of the throwaway probe
// Worker `animichi-spike-pi`. It is NOT the production edge — nothing under
// `workers/edge/src/` imports anything from this directory, and this Worker
// carries no identity, rate-limit or routing surface.
//
// Two Durable Object classes, one per spike: `PiTurnSession` hosts S1's single pi
// turn, `DurableTurnSession` hosts S4's deliberately-long alarm turn and its run
// status route.

import { DurableTurnSession } from "./durable-turn-session.ts";
import { configuredProviders, type ProviderKeys } from "./spike-models.ts";
import { databaseConfigured, type SpikeDatabaseKeys } from "./spike-database.ts";
import { routeOf, type SpikeRoute } from "./spike-routes.ts";
import { PiTurnSession } from "./turn-session.ts";

export { DurableTurnSession, PiTurnSession };

export interface SpikeEnv extends ProviderKeys, SpikeDatabaseKeys {
  PI_TURN: DurableObjectNamespace;
  PI_DURABLE: DurableObjectNamespace;
}

/** The S4 routes; everything else stays on S1's session. */
const DURABLE_ROUTES: readonly SpikeRoute[] = ["turn_long", "run_status"];

function healthResponse(env: SpikeEnv): Response {
  return Response.json({
    ok: true,
    worker: "animichi-spike-pi",
    providers: configuredProviders(env),
    database: databaseConfigured(env),
  });
}

function sessionNameOf(url: URL, fallback: string): string {
  return url.searchParams.get("session") ?? fallback;
}

function sessionFor(namespace: DurableObjectNamespace, name: string) {
  return namespace.get(namespace.idFromName(name));
}

export default {
  fetch(request: Request, env: SpikeEnv): Promise<Response> | Response {
    const url = new URL(request.url);
    const route = routeOf(request.method, url.pathname);
    if (route === "healthz") return healthResponse(env);
    if (route === "not_found") return Response.json({ error: "not found" }, { status: 404 });
    if (DURABLE_ROUTES.includes(route)) {
      return sessionFor(env.PI_DURABLE, sessionNameOf(url, "s4")).fetch(request);
    }
    return sessionFor(env.PI_TURN, sessionNameOf(url, "s1")).fetch(request);
  },
};
