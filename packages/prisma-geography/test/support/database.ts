import { AGENT_DB_SETUP_BUDGET, startTestPostgres, type TestPostgres } from "@animichi/test-postgres";
import postgresClient, { type PostgresClient } from "@prisma/orm-postgres/runtime";
import pg from "pg";
import contractJson from "../../src/contract.json" with { type: "json" };
import type { Contract } from "../../src/contract.d.ts";
import geographyRuntimeDescriptor from "../../src/geography/runtime.ts";
import { createTrigramIndex } from "./evidence.ts";
import { FILLER_SQL, KNOWN_POINTS } from "./fixtures.ts";
import { prisma } from "./prisma-cli.ts";
import { QueryLog, recordingPool } from "./recording-pool.ts";

export interface DatabaseFixture {
  readonly postgres: TestPostgres;
  readonly pool: pg.Pool;
  readonly db: PostgresClient<Contract>;
  readonly queryLog: QueryLog;
}

export async function startDatabaseFixture(): Promise<DatabaseFixture> {
  const postgres = await startTestPostgres({ database: "prisma_geography", budget: AGENT_DB_SETUP_BUDGET });
  const [pool, driverPool] = createPools(postgres.dsn);
  try {
    return await initializeFixture(postgres, pool, driverPool);
  } catch (failure) {
    await closeFailedStart(postgres, pool, driverPool);
    throw failure;
  }
}

export async function stopDatabaseFixture(fixture: DatabaseFixture): Promise<void> {
  const failures = await closeResources(fixture);
  failures.push(...await stopResource(fixture.postgres));
  throwCleanupFailures(failures);
}

async function initializeFixture(postgres: TestPostgres, pool: pg.Pool, driverPool: pg.Pool): Promise<DatabaseFixture> {
  await prisma(["db", "migrate", "--db", postgres.dsn]);
  const queryLog = new QueryLog();
  const db = createDatabaseClient(driverPool, queryLog);
  await db.connect();
  await seed(db, pool);
  return { postgres, pool, db, queryLog };
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

async function closeFailedStart(postgres: TestPostgres, pool: pg.Pool, driverPool: pg.Pool): Promise<void> {
  await Promise.allSettled([pool.end(), driverPool.end()]);
  await postgres.stop();
}

async function closeResources(fixture: DatabaseFixture): Promise<Error[]> {
  return failuresOf(await Promise.allSettled([
    Promise.resolve().then(() => fixture.db.close()),
    Promise.resolve().then(() => fixture.pool.end()),
  ]));
}

async function stopResource(postgres: TestPostgres): Promise<Error[]> {
  return failuresOf(await Promise.allSettled([Promise.resolve().then(() => postgres.stop())]));
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
