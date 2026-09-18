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
export const SESSION_ID = "01992000-0000-7000-8000-000000000046";
export const IDENTITY = "anon_00000000000000000000000000000046";
export const NOW = Date.parse("2026-09-10T12:00:00Z");
export const DAY = "2026-09-10";

before(async () => {
  const cluster = await startTestPostgresCluster({ budget: AGENT_DB_SETUP_BUDGET });
  const contract = resources.contract = await startContractDatabase(cluster, "native_admission");
  pool = resources.pool = new pg.Pool({ connectionString: contract.dsn });
  database = resources.database = nativeClient(contract.dsn);
});

beforeEach(async () => {
  await pool.query("TRUNCATE pi_sessions CASCADE; DELETE FROM anon_daily_message_count WHERE usage_date = '2026-09-10'");
  await pool.query("DELETE FROM sessions WHERE id = $1", [SESSION_ID]);
  await database.orm.public.PiSession.create({ id: SESSION_ID, metadata: { id: SESSION_ID, createdAt: NOW, storageVersion: 1 } });
});

after(async () => {
  try { await Promise.all([resources.database?.close(), resources.pool?.end()]); }
  finally { await resources.contract?.stop(); }
});

export async function quotaCount() {
  const result = await pool.query<{ count: number }>("SELECT message_count::integer AS count FROM anon_daily_message_count WHERE usage_date = $1 AND anon_id = $2", [DAY, IDENTITY]);
  return result.rows[0]?.count ?? 0;
}
