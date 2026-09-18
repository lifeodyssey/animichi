import { after, before, beforeEach } from "node:test";
import { AGENT_DB_SETUP_BUDGET, startTestPostgresCluster } from "@animichi/test-postgres";
import type { PostgresClient } from "@prisma/orm-postgres/runtime";
import type { Contract } from "@animichi/pi-session-neon/types";
import pg from "pg";
import { nativeClient } from "../src/native-client.ts";
import { startContractDatabase, type ContractDatabase } from "../test/contract-database.ts";

export let database: PostgresClient<Contract>;
export let pool: pg.Pool;
const resources: { contract?: ContractDatabase; database?: PostgresClient<Contract>; pool?: pg.Pool } = {};
export const SESSION_ID = "01992000-0000-7000-8000-000000000051";
export const IDENTITY = "anon_00000000000000000000000000000051";

before(async () => {
  const cluster = await startTestPostgresCluster({ budget: AGENT_DB_SETUP_BUDGET });
  const contract = resources.contract = await startContractDatabase(cluster, "native_selection");
  pool = resources.pool = new pg.Pool({ connectionString: contract.dsn });
  database = resources.database = nativeClient(contract.dsn);
});

beforeEach(async () => {
  await pool.query("TRUNCATE pi_sessions CASCADE");
  await pool.query("DELETE FROM sessions WHERE id = $1", [SESSION_ID]);
  await pool.query("INSERT INTO sessions (id, user_id) VALUES ($1, $2)", [SESSION_ID, IDENTITY]);
});

after(async () => {
  try { await Promise.all([resources.database?.close(), resources.pool?.end()]); }
  finally { await resources.contract?.stop(); }
});
