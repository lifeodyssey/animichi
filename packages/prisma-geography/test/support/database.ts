import { AGENT_DB_SETUP_BUDGET, createCleanDatabase, dropCleanDatabase, startTestPostgresCluster, uniqueDatabaseName, type TestPostgresCluster } from "@animichi/test-postgres";
import postgresClient, { type PostgresClient } from "@prisma/orm-postgres/runtime";
import pg from "pg";
import contractJson from "../../src/contract.json" with { type: "json" };
import type { Contract } from "../../src/contract.d.ts";
import geographyRuntimeDescriptor from "../../src/geography/runtime.ts";
import { createTrigramIndex } from "./evidence.ts";
import { FILLER_SQL, KNOWN_POINTS } from "./fixtures.ts";
import { prisma } from "./prisma-cli.ts";
import { QueryLog, recordingPool } from "./recording-pool.ts";

const CHAIN_SUITE = "prisma_geography_chain";

/** This pack's migration declares a `geography(Point,4326)` column and no extension; the evidence
 * builds a `gin_trgm_ops` index. The data plane's chain creates both for the real tables, so a
 * database this pack migrates alone has to bring them. */
const PACK_EXTENSIONS = ["postgis", "pg_trgm"] as const;

/** The database this fixture's pack chain migrated, and how to give it back (#1663). */
export interface ChainDatabase {
  readonly dsn: string;
  stop(): Promise<void>;
}

export interface DatabaseFixture {
  readonly chain: ChainDatabase;
  readonly pool: pg.Pool;
  readonly db: PostgresClient<Contract>;
  readonly queryLog: QueryLog;
}

export async function startDatabaseFixture(): Promise<DatabaseFixture> {
  const chain = await openChainDatabase(await startTestPostgresCluster({ budget: AGENT_DB_SETUP_BUDGET }));
  const [pool, driverPool] = createPools(chain.dsn);
  try {
    return await initializeFixture(chain, pool, driverPool);
  } catch (failure) {
    await closeFailedStart(chain, pool, driverPool);
    throw failure;
  }
}

/** The pack's own chain database: pristine `template1`, the extensions the pack's DDL relies on,
 * then `prisma db migrate`. It carries only this pack's chain — never the data plane's, whose
 * marker this pack's chain would meet as a `MIGRATION.MARKER_MISMATCH` (one chain per database,
 * spec §4.7). */
async function openChainDatabase(cluster: TestPostgresCluster): Promise<ChainDatabase> {
  const name = uniqueDatabaseName(CHAIN_SUITE);
  const dsn = await createCleanDatabase(cluster.adminDsn, name);
  const owned: ChainDatabase = { dsn, stop: () => dropCleanDatabase(cluster.adminDsn, name) };
  return useOwned(owned, async () => {
    await installExtensions(dsn);
    await prisma(["db", "migrate", "--db", dsn]);
    return owned;
  });
}

/** Run `work` on a database this call created; a failure hands it back first (#1663). */
async function useOwned<Result>(owned: ChainDatabase, work: () => Promise<Result>): Promise<Result> {
  try {
    return await work();
  } catch (failure) {
    await owned.stop();
    throw failure;
  }
}

async function installExtensions(dsn: string): Promise<void> {
  const client = new pg.Client(dsn);
  await client.connect();
  try {
    for (const extension of PACK_EXTENSIONS) {
      await client.query(`CREATE EXTENSION IF NOT EXISTS "${extension}"`);
    }
  } finally {
    await client.end();
  }
}

export async function stopDatabaseFixture(fixture: DatabaseFixture): Promise<void> {
  const failures = await closeResources(fixture);
  failures.push(...await stopResource(fixture.chain));
  throwCleanupFailures(failures);
}

async function initializeFixture(chain: ChainDatabase, pool: pg.Pool, driverPool: pg.Pool): Promise<DatabaseFixture> {
  const queryLog = new QueryLog();
  const db = createDatabaseClient(driverPool, queryLog);
  await db.connect();
  await seed(db, pool);
  return { chain, pool, db, queryLog };
}

function createPools(dsn: string): readonly [pg.Pool, pg.Pool] {
  return [new pg.Pool({ connectionString: dsn }), new pg.Pool({ connectionString: dsn })];
}

function createDatabaseClient(driverPool: pg.Pool, queryLog: QueryLog): PostgresClient<Contract> {
  return postgresClient<Contract>({
    contractJson,
    pg: recordingPool(driverPool, queryLog),
    extensions: [geographyRuntimeDescriptor],
  });
}

async function seed(db: PostgresClient<Contract>, pool: pg.Pool): Promise<void> {
  for (const point of KNOWN_POINTS) await db.orm.public.GeoPoint.create(point);
  await pool.query(FILLER_SQL);
  await createTrigramIndex(pool);
  await pool.query("ANALYZE geo_points");
}

async function closeFailedStart(chain: ChainDatabase, pool: pg.Pool, driverPool: pg.Pool): Promise<void> {
  await Promise.allSettled([pool.end(), driverPool.end()]);
  await chain.stop();
}

async function closeResources(fixture: DatabaseFixture): Promise<Error[]> {
  return failuresOf(await Promise.allSettled([
    Promise.resolve().then(() => fixture.db.close()),
    Promise.resolve().then(() => fixture.pool.end()),
  ]));
}

async function stopResource(resource: { stop(): Promise<void> }): Promise<Error[]> {
  return failuresOf(await Promise.allSettled([Promise.resolve().then(() => resource.stop())]));
}

function failuresOf(results: readonly PromiseSettledResult<void>[]): Error[] {
  return results.flatMap((result) => result.status === "rejected" ? [asError(result.reason)] : []);
}

function asError(reason: unknown): Error {
  return reason instanceof Error ? reason : new Error(String(reason));
}

function throwCleanupFailures(failures: readonly Error[]): void {
  const [first, second] = failures;
  if (first === undefined) return;
  if (second === undefined) throw first;
  throw new AggregateError(failures, "database fixture cleanup failed");
}
