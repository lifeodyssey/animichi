// W0-S4 spike (#1247): the Neon connection, on the convention
// `workers/users/src/db/client.ts` established — `neon()` + `drizzle/neon-http`,
// created per request from the connection string, never a module-level singleton.
//
// `SPIKE_DATABASE_URL` is a Worker secret and names ANY Neon branch: the spike
// writes real `runs` / `run_steps` rows, so pointing it at a throwaway branch is
// the whole safety story. Nothing here applies DDL; the branch must already carry
// the `migrations/neon` chain up to `20260902000000_agent_runs.sql`.

import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import type { SpikeRunDb } from "./postgres-run-store.ts";

export interface SpikeDatabaseKeys {
  SPIKE_DATABASE_URL?: string;
}

export function makeSpikeDb(connectionString: string): SpikeRunDb {
  return drizzle(neon(connectionString));
}

/** Presence only — the connection string is a secret and never reaches a response. */
export function databaseConfigured(keys: SpikeDatabaseKeys): boolean {
  return (keys.SPIKE_DATABASE_URL ?? "") !== "";
}
