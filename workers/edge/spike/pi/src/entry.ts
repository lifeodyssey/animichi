// W0-S1 spike (#1244): entry point of the throwaway probe Worker
// `animichi-spike-pi`. It is NOT the production edge — nothing under
// `workers/edge/src/` imports anything from this directory, and this Worker
// carries no identity, rate-limit or routing surface.

import { configuredProviders, type ProviderKeys } from "./spike-models.ts";
import { routeOf } from "./spike-routes.ts";
import { PiTurnSession } from "./turn-session.ts";

export { PiTurnSession };

export interface SpikeEnv extends ProviderKeys {
  PI_TURN: DurableObjectNamespace;
}

function healthResponse(env: SpikeEnv): Response {
  return Response.json({
    ok: true,
    worker: "animichi-spike-pi",
    providers: configuredProviders(env),
  });
}

function sessionFor(env: SpikeEnv, url: URL) {
  const name = url.searchParams.get("session") ?? "s1";
  return env.PI_TURN.get(env.PI_TURN.idFromName(name));
}

export default {
  fetch(request: Request, env: SpikeEnv): Promise<Response> | Response {
    const url = new URL(request.url);
    const route = routeOf(request.method, url.pathname);
    if (route === "healthz") return healthResponse(env);
    if (route === "not_found") return Response.json({ error: "not found" }, { status: 404 });
    return sessionFor(env, url).fetch(request);
  },
};
