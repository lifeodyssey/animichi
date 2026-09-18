import assert from "node:assert/strict";
import { after, before, beforeEach } from "node:test";
import { AGENT_DB_SETUP_BUDGET, startTestPostgres, type TestPostgres } from "@animichi/test-postgres";
import type { PostgresClient } from "@prisma/orm-postgres/runtime";
import type { Contract } from "@animichi/pi-session-neon/types";
import { nativeClient } from "../src/native-client.ts";
import { startContractDatabase, type ContractDatabase } from "../test/contract-database.ts";

export let db: PostgresClient<Contract>;
let postgres: TestPostgres | undefined;
let dsn: string;
const resources: { db?: PostgresClient<Contract>; contract?: ContractDatabase } = {};
export const SESSION = "recovery-session";

before(async () => {
  postgres = await startTestPostgres({ database: "native_recovery", budget: AGENT_DB_SETUP_BUDGET });
  const contract = resources.contract = await startContractDatabase(postgres, "native_recovery");
  dsn = contract.dsn;
  db = resources.db = nativeClient(dsn);
});

beforeEach(async () => {
  await db.orm.public.PiSession.where((row) => row.id.in([SESSION, "other-session"])).deleteAll();
  await session(SESSION);
});

after(async () => {
  try { await resources.db?.close(); }
  finally { await stopResources(); }
});

export function session(id: string) {
  return db.orm.public.PiSession.create({ id, metadata: { id, createdAt: 1, storageVersion: 1 } });
}

export function model(clientMessageId: string, state = "pending", sessionId = SESSION) {
  return db.orm.public.AgentAdmission.create({
    sessionId, clientMessageId, state, kind: "model", operationId: clientMessageId,
    identityId: "user", payer: "user", requestDigest: clientMessageId,
  });
}

export function selection(clientMessageId: string, state = "pending") {
  return db.orm.public.AgentAdmission.create({
    sessionId: SESSION, clientMessageId, state, kind: "selection",
    selectionRequest: { of: "points", pointIds: ["point"], origin: null, locale: "en" },
    identityId: "user", payer: "user", requestDigest: clientMessageId,
  });
}

export async function closedClient() {
  assert.ok(postgres);
  const client = nativeClient(dsn);
  await client.close();
  return client;
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
