/**
 * Connection-string resolution + pooled CatalogDb clients (story 10, #992).
 *
 * Splitting these out of the Worker entry keeps the composition root slim: the
 * HTTP app routes and the scheduled handlers share the same one-client-per-
 * connection-string pool, and tests tear it down via closeDbPools.
 */
import type { CatalogDb } from "./client";

/** The environment slice needed to resolve a connection string. */
export interface ConnectionEnv {
  HYPERDRIVE?: { connectionString: string };
  DATABASE_URL?: string | { get(): Promise<string> };
}

/** Prefer HYPERDRIVE, else the Neon URL / Secrets Store secret (#912 PR2). */
export async function connectionString(env?: ConnectionEnv): Promise<string | undefined> {
  if (env?.HYPERDRIVE?.connectionString) return env.HYPERDRIVE.connectionString;
  const url = env?.DATABASE_URL;
  if (url == null) return undefined;
  return typeof url === "string" ? url : await url.get();
}

interface DbEntry {
  db: CatalogDb;
}

// One client per connection string, reused across requests.
const dbPools = new Map<string, DbEntry>();

/** Resolve (and cache) a CatalogDb for a connection string. */
export async function dbFor(connStr: string): Promise<DbEntry> {
  const cached = dbPools.get(connStr);
  if (cached) return cached;
  const { makeDb: build } = await import("./client");
  const entry: DbEntry = { db: build(connStr) };
  dbPools.set(connStr, entry);
  return entry;
}

/** Clear the cached entries — for test teardown (neon-http is stateless). */
export function closeDbPools(): void {
  dbPools.clear();
}
