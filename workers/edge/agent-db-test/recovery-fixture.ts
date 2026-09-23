import assert from "node:assert/strict";
import { before, beforeEach } from "node:test";
import type { PostgresClient } from "@prisma/orm-postgres/runtime";
import type { Contract } from "@animichi/pi-session-neon/types";
import { nativeClient } from "../src/native-client.ts";
import { laneClient, laneDsn } from "./lane-contract-database.ts";

export let db: PostgresClient<Contract>;
let dsn: string;
export const SESSION = "recovery-session";

before(async () => {
  dsn = await laneDsn();
  db = await laneClient();
});

beforeEach(async () => {
  await db.orm.public.PiSession.where((row) => row.id.in([SESSION, "other-session"])).deleteAll();
  await session(SESSION);
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

/** Its own client, closed here rather than with the lane: a client this
 * function has already closed must not be closed a second time. */
export async function closedClient() {
  assert.ok(dsn);
  const client = nativeClient(dsn);
  await client.close();
  return client;
}
