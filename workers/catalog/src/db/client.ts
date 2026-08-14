/** The single Drizzle adapter seam for the Catalog data plane (story 10, #992).
 *
 * All database access — reads and writes — crosses this one seam. Statements
 * are built with the Drizzle query builder + the typed expression helpers in
 * `./expressions`, then executed through `db.execute` / `db.batch`. There is
 * no second client: the direct Neon tagged-query channel was removed.
 */
import { neon } from "@neondatabase/serverless";
import { drizzle, type NeonHttpDatabase } from "drizzle-orm/neon-http";
import type { SQL } from "drizzle-orm";
import * as schema from "./schema";

export type CatalogDb = NeonHttpDatabase<typeof schema>;

/** Minimal structural type for functions that only call `.execute()` (db or tx). */
export interface DbExecutor { execute: (query: SQL | { getSQL(): SQL }) => Promise<{ rows: unknown[] }> }

/**
 * A builder-only Drizzle database used to CONSTRUCT statements (never to run
 * them). Its `.select()/.insert()/.update()/.delete()` chain produces a typed
 * statement whose `.getSQL()` is executed through the `CatalogDb` / `DbExecutor`
 * seam, so a statement can be built without a live client and reused across
 * reads, writes, and `db.batch` — mirroring how `publishVersionStatements`
 * hands the flip+insert pair to the enrich batch.
 *
 * LIVE-NEON: running builder statements through this seam under workerd +
 * neon-http (the "fluent builder hangs" note in AGENTS.md) can only be proven
 * against a real Neon branch — the worker-pool tests execute through fakes.
 * This slice converted every complete-SQL statement to the builder; the actual
 * runtime behaviour needs live-Neon validation before merge.
 */
export function statementBuilder(): NeonHttpDatabase<typeof schema> {
  return drizzle.mock();
}

export function makeDb(connStr: string): CatalogDb {
  const sql = neon(connStr);
  return drizzle(sql, { schema });
}
