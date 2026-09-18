import assert from "node:assert/strict";
import { after, before, beforeEach } from "node:test";
import { AGENT_DB_SETUP_BUDGET, startTestPostgresCluster } from "@animichi/test-postgres";
import type { PostgresClient } from "@prisma/orm-postgres/runtime";
import type { Contract } from "@animichi/pi-session-neon/types";
import { nativeClient } from "../src/native-client.ts";
import { startContractDatabase, type ContractDatabase } from "../test/contract-database.ts";

export let db: PostgresClient<Contract>;
let dsn: string;
const resources: { db?: PostgresClient<Contract>; contract?: ContractDatabase } = {};
export const SESSION = "recovery-session";

before(async () => {
  const cluster = await startTestPostgresCluster({ budget: AGENT_DB_SETUP_BUDGET });
  const contract = resources.contract = await startContractDatabase(cluster, "native_recovery");
  dsn = contract.dsn;
  db = resources.db = nativeClient(dsn);
});

beforeEach(async () => {
  await db.orm.public.PiSession.where((row) => row.id.in([SESSION, "other-session"])).deleteAll();
  await session(SESSION);
});

after(async () => {
  try { await resources.db?.close(); }
  finally { await resources.contract?.stop(); }
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
  assert.ok(dsn);
  const client = nativeClient(dsn);
  await client.close();
  return client;
}
