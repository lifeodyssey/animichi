import { after, before, beforeEach } from "node:test";
import { AGENT_DB_SETUP_BUDGET, createCleanDatabase, dropCleanDatabase, startTestPostgres, uniqueDatabaseName, type TestPostgres } from "@animichi/test-postgres";
import { type PostgresClient } from "@prisma/orm-postgres/runtime";
import pg from "pg";
import type { Contract } from "../src/contract.d.ts";
import { contractClient } from "./contract-client.ts";
import { migrate } from "./prisma-migration.ts";
import { QUOTA_AGGREGATES } from "./quota-aggregates.ts";

// `postgres` is the disposable cluster (its database is the Atlas-applied one, used only as the
// admin connection and role source until #1625). `contractDsn` is the shared-suite database:
// created from template1 and migrated by this package's own single chain, so no test sees an
// Atlas-era overlay. The migration-target ACs create their own chain-only database instead. The two
// quota aggregates the business examples target are installed by this fixture alone
// (`quota-aggregates.ts`).
export let postgres: TestPostgres;
export let contractDsn: string;
export let pool: pg.Pool;
export let database: PostgresClient<Contract>;
export let servicePool: pg.Pool;
export let serviceDatabase: PostgresClient<Contract>;
interface Resources {
  postgres?: TestPostgres;
  contractDatabase?: string;
  pool?: pg.Pool;
  database?: PostgresClient<Contract>;
  servicePool?: pg.Pool;
  serviceDatabase?: PostgresClient<Contract>;
}
const resources: Resources = {};
export const SESSION_ID = "schema-test";
export const METADATA = { id: SESSION_ID, createdAt: 123, storageVersion: 1, parentSessionId: "deleted-parent" };

async function startContractDatabase(): Promise<string> {
  postgres = resources.postgres = await startTestPostgres({ database: "harness_schema", budget: AGENT_DB_SETUP_BUDGET });
  // The server is shared and outlives this run (#1663), so the suite's database is named
  // per call and dropped by the fixture that created it.
  const name = resources.contractDatabase = uniqueDatabaseName("harness_contract");
  contractDsn = await createCleanDatabase(postgres.dsn, name);
  pool = resources.pool = new pg.Pool({ connectionString: contractDsn });
  await migrate(contractDsn);
  await pool.query(QUOTA_AGGREGATES);
  return contractDsn;
}

before(async () => {
  const dsn = await startContractDatabase();
  database = resources.database = contractClient(dsn);
  servicePool = resources.servicePool = new pg.Pool({ connectionString: dsn, options: "-c role=agent_svc" });
  const serviceUrl = new URL(dsn);
  serviceUrl.searchParams.set("options", "-c role=agent_svc");
  serviceDatabase = resources.serviceDatabase = contractClient(serviceUrl.href);
});

beforeEach(async () => {
  await pool.query("TRUNCATE TABLE pi_sessions, anon_daily_message_count, daily_usage CASCADE");
  await database.orm.public.PiSession.create({ id: SESSION_ID, metadata: METADATA });
});

after(async () => {
  try { await Promise.all([resources.database?.close(), resources.pool?.end(), resources.serviceDatabase?.close(), resources.servicePool?.end()]); }
  finally { await stopDatabases(); }
});

/** Order matters: the contract database is dropped through the shared server `postgres.dsn`
 * reaches, so `stop()` — which drops that server's own database — comes second. */
async function stopDatabases(): Promise<void> {
  const contract = resources.contractDatabase;
  try {
    if (contract !== undefined) await dropCleanDatabase(postgres.dsn, contract);
  } finally {
    await resources.postgres?.stop();
  }
}
