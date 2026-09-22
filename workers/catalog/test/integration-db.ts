import pg from "pg";
import { describe, inject } from "vitest";
import { acquireCatalogRuntime, catalogPrisma, type CatalogPrisma } from "../src/db/prisma";

/** The suite-owned Postgres context, always provided by the Docker arm setup. */
export interface IntegrationDatabaseContext {
  enabled: boolean;
  /** The Prisma data plane (#1626): the shape every real environment has, and
   * since #1633 the only one — the pre-Prisma database went with the query
   * layer that wrote it. */
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

const context = inject("integrationDatabase");

let planePoolCache: pg.Pool | null = null;

const UNAVAILABLE =
  "integration database is unavailable — the Docker Postgres arm must run (docker + the animichi-test-postgres image)";

function requireEnabled(): IntegrationDatabaseContext {
  if (!context.enabled) throw new Error(UNAVAILABLE);
  return context;
}

/**
 * The suite's DSN — its own database, cloned from the container's migrated
 * template (#1769). Never the plane's own database: one chain per database, and
 * a suite that migrated the plane's would collide with every other arm sharing
 * the container (see `integration-db-global.ts`).
 */
export function planeDatabaseUrl(): string {
  return requireEnabled().planeDsn;
}

/** A pg pool rooted at the suite database, for the rows a suite seeds and
 *  reads back with statements rather than plans. */
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
  const runtime = await acquireCatalogRuntime(planeDatabaseUrl());
  return {
    query: catalogPrisma(runtime),
    dispose: async () => { await runtime[Symbol.asyncDispose](); },
  };
}

/**
 * A suite's two seams over ONE database: the pool its fixtures seed and assert
 * through, and the plan seam the code under test runs on.
 *
 * The suite takes one of these per file, so the database instance it seeds and
 * the one its plans reach are the same by construction rather than by two DSNs
 * happening to agree — and the seeding never crosses the seam under test, so a
 * plan that wrote the wrong row cannot also be what reads it back.
 */
export interface PlaneSeams {
  readonly pool: pg.Pool;
  readonly query: CatalogPrisma;
  dispose(): Promise<void>;
}

export async function openPlaneSeams(): Promise<PlaneSeams> {
  const prisma = await openPlanePrisma();
  return { pool: planePool(), query: prisma.query, dispose: () => prisma.dispose() };
}

export function directPoolConfig(connectionString: string): pg.PoolConfig {
  return { connectionString, connectionTimeoutMillis: 10_000 };
}

export function catalogTruncateSql(): string {
  const identifiers = CATALOG_TABLES.map((table) => `"${table}"`).join(", ");
  return `TRUNCATE ${identifiers} RESTART IDENTITY`;
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
