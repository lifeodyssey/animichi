import { after, before, beforeEach } from "node:test";
import { AGENT_DB_SETUP_BUDGET, createMigratedDatabase, dropCleanDatabase, startTestPostgresCluster, uniqueDatabaseName, type TestPostgresCluster } from "@animichi/test-postgres";
import { type PostgresClient } from "@prisma/orm-postgres/runtime";
import pg from "pg";
import type { Contract } from "../src/contract.d.ts";
import { contractClient } from "./contract-client.ts";

// `cluster` is the disposable server: its admin database is where this fixture creates and drops
// databases, and it carries the five service roles, which `@animichi/test-postgres` creates
// because a disposable container has no Pulumi (#1625).
// `contractDsn` is the shared-suite database: cloned from the migrated template (#1769), so no
// test sees an overlay from another chain. The migration-target ACs create their own chain-only
// database instead. Every object the business examples target — the conversation ledger and the
// two quota meters included — comes from that schema.
export let cluster: TestPostgresCluster;
export let contractDsn: string;
export let pool: pg.Pool;
export let database: PostgresClient<Contract>;
export let servicePool: pg.Pool;
export let serviceDatabase: PostgresClient<Contract>;
interface Resources {
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
  cluster = await startTestPostgresCluster({ budget: AGENT_DB_SETUP_BUDGET });
  // The server is shared and outlives this run (#1663), so the suite's database is named
  // per call and dropped by the fixture that created it.
  const name = resources.contractDatabase = uniqueDatabaseName("harness_contract");
  contractDsn = await createMigratedDatabase(cluster.adminDsn, name);
  pool = resources.pool = new pg.Pool({ connectionString: contractDsn });
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
  finally { await dropContractDatabase(); }
});

async function dropContractDatabase(): Promise<void> {
  const contract = resources.contractDatabase;
  if (contract !== undefined) await dropCleanDatabase(cluster.adminDsn, contract);
}
