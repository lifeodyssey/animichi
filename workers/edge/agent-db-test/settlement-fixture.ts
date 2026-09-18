import { after, before, beforeEach } from "node:test";
import { AGENT_DB_SETUP_BUDGET, startTestPostgres, type TestPostgres } from "@animichi/test-postgres";
import type { PostgresClient } from "@prisma/orm-postgres/runtime";
import type { Contract } from "@animichi/pi-session-neon/types";
import { nativeClient } from "../src/native-client.ts";
import { startContractDatabase, type ContractDatabase } from "../test/contract-database.ts";

export let db: PostgresClient<Contract>;
let postgres: TestPostgres | undefined;
const resources: { db?: PostgresClient<Contract>; contract?: ContractDatabase } = {};
export const SESSION = "settlement-session";

before(async () => {
  postgres = await startTestPostgres({ database: "native_settlement", budget: AGENT_DB_SETUP_BUDGET });
  const contract = resources.contract = await startContractDatabase(postgres, "native_settlement");
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
  finally { await stopResources(); }
});

export function session(id: string) {
  return db.orm.public.PiSession.create({ id, metadata: { id, createdAt: 1, storageVersion: 1 } });
}

/** Order matters: the contract database is dropped through the shared server the `TestPostgres`
 * owns, so its `stop()` — which drops that server's own database — comes second. */
async function stopResources(): Promise<void> {
  try {
    await resources.contract?.stop();
  } finally {
    await postgres?.stop();
  }
}
