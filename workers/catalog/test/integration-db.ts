import { neonConfig } from "@neondatabase/serverless";
import { sql } from "drizzle-orm";
import pg from "pg";
import { describe, inject } from "vitest";
import type { CatalogDb } from "../src/db/client";
import { acquireCatalogRuntime, catalogPrisma, type CatalogPrisma } from "../src/db/prisma";
import { makePgCatalog } from "./integration-db-global/pg-catalog";

/** The suite-owned Postgres context, always provided by the Docker arm setup. */
export interface IntegrationDatabaseContext {
  enabled: boolean;
  /** The pre-Prisma shape (`drizzle-era-catalog.sql`) — what the files that
   * still write it need, the staging import above all, until #1629–#1631 move
   * the rest of the query layer. */
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
let planePoolCache: pg.Pool | null = null;

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

/**
 * The Prisma-plane DSN — the suite's own database, cloned from the container's
 * migrated template (#1769). Never the plane's own database: one chain per
 * database, and a suite that migrated the plane's would collide with every other
 * arm sharing the container (see `integration-db-global.ts`).
 *
 * Since #1630 this is where the ingest/enrich/publish suites run: the plan's
 * contract is generated from that chain, so the pre-Prisma `dsn` shape below no
 * longer carries the columns those writes name.
 */
export function planeDatabaseUrl(): string {
  return requireEnabled().planeDsn;
}

/** A single shared pg.Pool rooted at the suite database. */
export function sharedPool(): pg.Pool {
  poolCache ??= new pg.Pool(directPoolConfig(localDatabaseUrl()));
  return poolCache;
}

/** A pg pool rooted at the Prisma-PLANE database, for rows the converted
 *  suites read and seed with statements rather than plans. */
export function planePool(): pg.Pool {
  planePoolCache ??= new pg.Pool(directPoolConfig(planeDatabaseUrl()));
  return planePoolCache;
}

/**
 * The Prisma seam as the Worker has it: one runtime acquired on the plane
 * database plus the shared contract's builder, disposed by the caller.
 *
 * Suites take ONE of these for the file (a `beforeAll`/`afterAll` pair), the
 * same shape the `/catalog/*` boundary gives a request, rather than one per
 * test — the suite is the scope, and a per-test runtime would spend the suite's
 * time on TLS handshakes.
 */
export interface PlanePrisma {
  readonly query: CatalogPrisma;
  dispose(): Promise<void>;
}

export async function openPlanePrisma(): Promise<PlanePrisma> {
  return openPrismaSeam(planeDatabaseUrl());
}

/**
 * The plan seam over ANY suite database — the same builder and runtime the
 * Worker builds, pointed at a DSN the caller names.
 *
 * This exists for the suites whose own shape is not the plane's: the staging
 * import still writes the pre-Prisma column set, so its database stays
 * `_legacy`, while the reads it drives (the candidate export) are plans now and
 * must reach that same database to see the rows it seeded.
 */
export async function openPrismaSeam(url: string): Promise<PlanePrisma> {
  const runtime = await acquireCatalogRuntime(url);
  return {
    query: catalogPrisma(runtime),
    dispose: async () => { await runtime[Symbol.asyncDispose](); },
  };
}

/** The pg-backed CatalogDb the "serverless" seam now resolves to. */
export function pgCatalog(): CatalogDb {
  return makePgCatalog(sharedPool());
}

/**
 * The pg-backed CatalogDb over the Prisma-PLANE database — the SAME database
 * the plan seam reaches, so a suite can seed and assert with statements while
 * the code under test writes plans (#1630).
 *
 * A suite that mixed the two DSNs would seed one database and assert against
 * the other; naming this seam keeps the still-Drizzle collaborators (the
 * snapshot publish) and the converted ones on one plane.
 */
export function planeCatalog(): CatalogDb {
  return makePgCatalog(planePool());
}

/**
 * A suite's two seams over ONE plane database: the statement seam its fixtures
 * and still-Drizzle collaborators use, and the plan seam the converted code
 * under test writes through.
 *
 * The suite takes one of these per file, so the database instance it seeds and
 * the one its plans reach are the same by construction rather than by two DSNs
 * happening to agree.
 */
export interface PlaneSeams {
  readonly db: CatalogDb;
  readonly query: CatalogPrisma;
  dispose(): Promise<void>;
}

export async function openPlaneSeams(): Promise<PlaneSeams> {
  const prisma = await openPlanePrisma();
  return { db: planeCatalog(), query: prisma.query, dispose: () => prisma.dispose() };
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
    throw new Error("TRUNCATE failed during catalog integration isolation", { cause: error });
  }
}

export async function truncateCatalogPool(pool: pg.Pool): Promise<void> {
  try {
    await pool.query(catalogTruncateSql());
  } catch (error) {
    throw new Error("TRUNCATE failed during catalog integration isolation", { cause: error });
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
