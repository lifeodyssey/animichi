import { neonConfig } from "@neondatabase/serverless";
import { sql } from "drizzle-orm";
import pg from "pg";
import { describe, inject } from "vitest";
import { makeDb, type CatalogDb } from "../src/db/client";

export type SpikeDatabaseContext =
  | { enabled: false; skipMessage: string }
  | {
    enabled: true;
    localDsn: string;
    localHost: string;
    localPort: number;
    directDsn: string;
  };

declare module "vitest" {
  export interface ProvidedContext {
    spikeDatabase: SpikeDatabaseContext;
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

const context = inject("spikeDatabase");
const initialConfig = captureNeonConfig();

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

function enabledContext(): Extract<SpikeDatabaseContext, { enabled: true }> {
  if (!context.enabled) throw new Error(context.skipMessage);
  return context;
}

/**
 * Serverless-driver config for the DIRECT cloud endpoint (directDsn).
 *
 * The neon_local container proxy (#883) is 11 months old and does not bind
 * 5432 on current runners; routing the driver through it produced both the
 * 180s port timeout and the "parse error - invalid geometry" bytea mangling.
 * Node 22+ ships a native WebSocket, so poolQueryViaFetch=false gives a
 * direct encrypted connection to the ephemeral branch with no container.
 */
function configureDirectDriver(): void {
  neonConfig.poolQueryViaFetch = false;
  neonConfig.useSecureWebSocket = true;
}

function pause(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function ready(db: CatalogDb): Promise<boolean> {
  try {
    await db.execute(sql`SELECT 1`);
    return true;
  } catch {
    return false;
  }
}

async function waitUntilReady(db: CatalogDb): Promise<void> {
  for (const delay of [0, 1_000, 2_000, 4_000, 8_000, 16_000]) {
    if (delay > 0) await pause(delay);
    if (await ready(db)) return;
  }
  throw new Error("Neon Local serverless endpoint was not ready within 31 seconds");
}

export async function openServerlessDb(): Promise<CatalogDb> {
  configureDirectDriver();
  const db = makeDb(enabledContext().directDsn);
  await readyOrRestore(db);
  return db;
}

async function readyOrRestore(db: CatalogDb): Promise<void> {
  try {
    await waitUntilReady(db);
  } catch (error) {
    restoreNeonConfig();
    throw error;
  }
}

async function poolReady(pool: pg.Pool): Promise<boolean> {
  try {
    await pool.query("SELECT 1");
    return true;
  } catch {
    return false;
  }
}

async function waitUntilPoolReady(pool: pg.Pool): Promise<void> {
  for (const delay of [0, 1_000, 2_000, 4_000, 8_000, 16_000]) {
    if (delay > 0) await pause(delay);
    if (await poolReady(pool)) return;
  }
  throw new Error("Neon direct cloud endpoint was not ready after six bounded attempts");
}

export async function openDirectPool(): Promise<pg.Pool> {
  const pool = new pg.Pool(directPoolConfig(enabledContext().directDsn));
  try {
    await waitUntilPoolReady(pool);
    return pool;
  } catch (error) {
    await pool.end();
    throw error;
  }
}

export function directPoolConfig(connectionString: string): pg.PoolConfig {
  return { connectionString, connectionTimeoutMillis: 10_000 };
}

export function localDatabaseUrl(): string {
  return enabledContext().directDsn;
}

export function catalogTruncateSql(): string {
  const identifiers = CATALOG_TABLES.map((table) => `"${table}"`).join(", ");
  return `TRUNCATE ${identifiers} RESTART IDENTITY`;
}

export async function truncateCatalog(db: CatalogDb): Promise<void> {
  try {
    await db.execute(sql.raw(catalogTruncateSql()));
  } catch (error) {
    throw new Error("catalog spike isolation failed; review the FK-closed table set", {
      cause: error,
    });
  }
}

export async function truncateCatalogPool(pool: pg.Pool): Promise<void> {
  try {
    await pool.query(catalogTruncateSql());
  } catch (error) {
    throw new Error("catalog spike isolation failed; review the FK-closed table set", {
      cause: error,
    });
  }
}

export function databaseDescribe(name: string, factory: () => void): void {
  if (context.enabled) {
    describe(name, factory);
    return;
  }
  describe.skip(`${name} — ${context.skipMessage}`, factory);
}

/**
 * Suite with a KNOWN live failure tracked by a GitHub issue. Skipped until the
 * issue is fixed so the spike gate stays honest without going red.
 */
export function databaseDescribeKnownFailing(
  issue: string, name: string, factory: () => void,
): void {
  describe.skip(`${name} — known-failing: ${issue}`, factory);
}
