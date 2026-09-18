import { after, before, beforeEach } from "node:test";
import { AGENT_DB_SETUP_BUDGET, startTestPostgresCluster } from "@animichi/test-postgres";
import type { PostgresClient } from "@prisma/orm-postgres/runtime";
import type { Contract } from "@animichi/pi-session-neon/types";
import { nativeClient } from "../src/native-client.ts";
import { startContractDatabase, type ContractDatabase } from "../test/contract-database.ts";

export let db: PostgresClient<Contract>;
const resources: { db?: PostgresClient<Contract>; contract?: ContractDatabase } = {};
export const SESSION = "settlement-session";

before(async () => {
  const cluster = await startTestPostgresCluster({ budget: AGENT_DB_SETUP_BUDGET });
  const contract = resources.contract = await startContractDatabase(cluster, "native_settlement");
  db = resources.db = nativeClient(contract.dsn);
});

beforeEach(async () => {
  await db.orm.public.PiSession.where((row) => row.id.in([SESSION, "other-session"])).deleteAll();
  await db.runtime().execute(db.raw.sql`DELETE FROM daily_usage`.affectedCount().build());
  await db.runtime().execute(db.raw.sql`DELETE FROM anon_daily_message_count`.affectedCount().build());
  await session(SESSION);
});

after(async () => {
  try { await resources.db?.close(); }
  finally { await resources.contract?.stop(); }
});

export function session(id: string) {
  return db.orm.public.PiSession.create({ id, metadata: { id, createdAt: 1, storageVersion: 1 } });
}
