// W0-S4 spike (#1247): the Durable Object class the long turn runs in.
//
// Deliberately a separate class from S1's `PiTurnSession`: the two spikes ask
// different questions, and keeping them apart means S4 adds a binding and a
// migration tag instead of editing the probe S1's measurements were taken on.
// All behaviour lives in the three objects `makeTurnHost` assembles; this class
// is only the runtime seam between them and workerd.

import { PostgresRunStore } from "./postgres-run-store.ts";
import type { RunStore } from "./run-store.ts";
import { makeSpikeDb, type SpikeDatabaseKeys } from "./spike-database.ts";
import { routeOf, runIdOf } from "./spike-routes.ts";
import { makeTurnHost, type TurnHost } from "./turn-host.ts";

/** The turn's holds are real time on the deployed Worker and injected in tests. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sessionOf(url: URL): string {
  return url.searchParams.get("session") ?? "s4";
}

/** No connection string, no store: every route then answers 503 rather than guessing. */
function storeFor(env: SpikeDatabaseKeys): RunStore | null {
  const url = env.SPIKE_DATABASE_URL ?? "";
  return url === "" ? null : new PostgresRunStore(makeSpikeDb(url));
}

export class DurableTurnSession {
  private readonly host: TurnHost;

  constructor(ctx: DurableObjectState, env: SpikeDatabaseKeys) {
    this.host = makeTurnHost(ctx, storeFor(env), () => Date.now(), sleep);
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const runId = runIdOf(url.pathname);
    if (routeOf(request.method, url.pathname) === "run_status" && runId !== null) {
      return await this.host.status.report(runId);
    }
    return await this.host.intake.open(request, sessionOf(url));
  }

  async alarm(): Promise<void> {
    await this.host.loop.runPending();
  }
}
