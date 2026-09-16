import { after, before, beforeEach } from "node:test";
import { AGENT_DB_SETUP_BUDGET, startTestPostgres, type TestPostgres } from "@animichi/test-postgres";
import type { PostgresClient } from "@prisma/orm-postgres/runtime";
import type { Contract } from "@animichi/pi-session-neon/types";
import pg from "pg";
import { nativeClient } from "../src/native-client.ts";
import { startContractDatabase, type ContractDatabase } from "../test/contract-database.ts";

export let database: PostgresClient<Contract>;
export let pool: pg.Pool;
const resources: { postgres?: TestPostgres; contract?: ContractDatabase; database?: PostgresClient<Contract>; pool?: pg.Pool } = {};
export const SESSION_ID = "01992000-0000-7000-8000-000000000051";
export const IDENTITY = "anon_00000000000000000000000000000051";

before(async () => {
  const postgres = resources.postgres = await startTestPostgres({ database: "native_selection", budget: AGENT_DB_SETUP_BUDGET });
  const contract = resources.contract = await startContractDatabase(postgres, "native_selection");
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
  finally { await stopResources(); }
});

/** Order matters: the contract database is dropped through the shared server the `TestPostgres`
 * owns, so its `stop()` — which drops that server's own database — comes second. */
async function stopResources(): Promise<void> {
  try {
    await resources.contract?.stop();
  } finally {
    await resources.postgres?.stop();
  }
}
