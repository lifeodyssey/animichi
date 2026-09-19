import { neonConfig } from "@neondatabase/serverless";
import { sql } from "drizzle-orm";
import pg from "pg";
import { describe, inject } from "vitest";
import type { CatalogDb } from "../src/db/client";
import { makePgCatalog } from "./integration-db-global/pg-catalog";

/** The suite-owned Postgres context, always provided by the Docker arm setup. */
export interface IntegrationDatabaseContext {
  enabled: boolean;
  /** The pre-Prisma shape (`drizzle-era-catalog.sql`): every integration file
   * except the nearby path, until #1629–#1631 move the rest of the query layer. */
  dsn: string;
  /** The Prisma data plane (#1626): the shape every real environment has, and
   * the one the nearby path reads since #1628. */
  planeDsn: string;
}

declare module "vitest" {
  export interface ProvidedContext {
    integrationDatabase: IntegrationDatabaseContext;
  }
}

export const CATALOG_TABLES = [
  "bangumi",
  "points",
  "cluster_version",
  "itinerary_snapshots",
  "aliases",
  "series_edges",
  "leg_cache",
  "raw_anitabi",
  "raw_bangumi",
  "raw_payload_history",
  "catalog_runs",
  "catalog_provenance",
  "media_assets",
  "ingest_jobs",
  "saved_route_anime",
] as const;

export interface NeonConfigSnapshot {
  fetchEndpoint: typeof neonConfig.fetchEndpoint;
  poolQueryViaFetch: typeof neonConfig.poolQueryViaFetch;
  useSecureWebSocket: typeof neonConfig.useSecureWebSocket;
  wsProxy: typeof neonConfig.wsProxy;
}

const context = inject("integrationDatabase");
const initialConfig = captureNeonConfig();

let poolCache: pg.Pool | null = null;

const UNAVAILABLE =
  "integration database is unavailable — the Docker Postgres arm must run (docker + the animichi-test-postgres image)";

export function captureNeonConfig(): NeonConfigSnapshot {
  return {
    fetchEndpoint: neonConfig.fetchEndpoint,
    poolQueryViaFetch: neonConfig.poolQueryViaFetch,
    useSecureWebSocket: neonConfig.useSecureWebSocket,
    wsProxy: neonConfig.wsProxy,
  };
}

export function restoreNeonConfig(snapshot: NeonConfigSnapshot = initialConfig): void {
  neonConfig.fetchEndpoint = snapshot.fetchEndpoint;
  neonConfig.poolQueryViaFetch = snapshot.poolQueryViaFetch;
  neonConfig.useSecureWebSocket = snapshot.useSecureWebSocket;
  neonConfig.wsProxy = snapshot.wsProxy;
}

function requireEnabled(): IntegrationDatabaseContext {
  if (!context.enabled) throw new Error(UNAVAILABLE);
  return context;
}

/** The suite DSN — absolute to the clean database the Docker arm prepared. */
export function localDatabaseUrl(): string {
  return requireEnabled().dsn;
}

/** The Prisma-plane DSN — the suite's own database, cloned from the container's
 * migrated template (#1769). Never the plane's own database: one chain per
 * database, and a suite that migrated the plane's would collide with every other
 * arm sharing the container (see `integration-db-global.ts`). */
export function planeDatabaseUrl(): string {
  return requireEnabled().planeDsn;
}

/** A single shared pg.Pool rooted at the suite database. */
export function sharedPool(): pg.Pool {
  poolCache ??= new pg.Pool(directPoolConfig(localDatabaseUrl()));
  return poolCache;
}

/** The pg-backed CatalogDb the "serverless" seam now resolves to. */
export function pgCatalog(): CatalogDb {
  return makePgCatalog(sharedPool());
}

export function openServerlessDb(): Promise<CatalogDb> {
  return Promise.resolve(pgCatalog());
}

export async function openDirectPool(): Promise<pg.Pool> {
  const pool = new pg.Pool(directPoolConfig(localDatabaseUrl()));
  try {
    await pool.query("SELECT 1");
    return pool;
  } catch (error) {
    await pool.end();
    throw error;
  }
}

export function directPoolConfig(connectionString: string): pg.PoolConfig {
  return { connectionString, connectionTimeoutMillis: 10_000 };
}

export function catalogTruncateSql(): string {
  const identifiers = CATALOG_TABLES.map((table) => `"${table}"`).join(", ");
  return `TRUNCATE ${identifiers} RESTART IDENTITY`;
}

export async function truncateCatalog(db: CatalogDb): Promise<void> {
  try {
    await db.execute(sql.raw(catalogTruncateSql()));
  } catch (error) {
    throw new Error("catalog integration isolation failed; review the FK-closed table set", { cause: error });
  }
}

export async function truncateCatalogPool(pool: pg.Pool): Promise<void> {
  try {
    await pool.query(catalogTruncateSql());
  } catch (error) {
    throw new Error("catalog integration isolation failed; review the FK-closed table set", { cause: error });
  }
}

/** Gate tests on a live suite database. Fails loudly when the DB is down —
 * the old silent-skip mode is removed (card 1049 AC2). */
export function databaseDescribe(name: string, factory: () => void): void {
  requireEnabled();
  describe(name, factory);
}

/** Suite with a KNOWN live failure tracked by a GitHub issue. Skipped until the
 * issue is fixed so the integration gate stays honest without going red. */
export function databaseDescribeKnownFailing(
  issue: string, name: string, factory: () => void,
): void {
  describe.skip(`${name} — known-failing: ${issue}`, factory);
}
