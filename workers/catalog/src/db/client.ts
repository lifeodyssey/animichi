import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

/**
 * Drizzle client factory for the Catalog service.
 *
 * Uses drizzle-orm/node-postgres over a `pg` Pool — the driver validated by the
 * PostGIS spike (catalog/test/postgis.spike.test.ts). In production the same
 * code path runs against a Cloudflare Hyperdrive connection string; locally it
 * points at the Supabase/testcontainer Postgres. The caller owns the connection
 * string so prod can swap in Hyperdrive without touching this module.
 */
export type CatalogDb = NodePgDatabase<typeof schema>;

export function makeDb(connStr: string): CatalogDb {
  const pool = new pg.Pool({ connectionString: connStr });
  return drizzle(pool, { schema });
}
