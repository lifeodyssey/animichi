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

export function makeDb(connStr: string): CatalogDb {
  const sql = neon(connStr);
  return drizzle(sql, { schema });
}
