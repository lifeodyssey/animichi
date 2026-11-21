import assert from "node:assert/strict";
import { test } from "node:test";
import { admitModelRequest } from "../src/agent/admission/admit-model-request.ts";
import { prepareOperationSettlement, settleModelOperation } from "../src/agent/settlement/native-settlement.ts";
import { context, nativeHarness } from "./harness.ts";
import { database, IDENTITY, NOW, pool, SESSION_ID } from "./postgres.ts";

const text = "Find an anime pilgrimage in Tokyo";
const request = { sessionId: SESSION_ID, identityId: IDENTITY, payer: "anon", locale: "en", clientMessageId: "title", text } as const;
const options = { anonymousAllowance: 1, now: NOW };

async function conversation() {
  const result = await pool.query<{ firstQuery: string | null; title: string | null }>(
    "SELECT first_query AS \"firstQuery\", title FROM sessions WHERE id = $1", [SESSION_ID],
  );
  return result.rows[0];
}

void test("a new native admission stores the caller's first query verbatim", async () => {
  const native = await nativeHarness();
  try {
    assert.equal((await admitModelRequest(database, native.lane, context, request, options)).kind, "accepted");
    assert.deepEqual(await conversation(), { firstQuery: text, title: null });
  } finally { await native.close(); }
});

void test("the first successful native settlement stores the first query title", async () => {
  const native = await nativeHarness();
  try {
    const accepted = await admitModelRequest(database, native.lane, context, request, options);
    assert.ok(accepted.operationId);
    assert.equal((await conversation())?.title, null);
    assert.equal(await prepareOperationSettlement(database, native.session, accepted.operationId, context), true);
    assert.equal((await native.lane.drive({ operationId: accepted.operationId }, context)).ok, true);
    assert.equal((await settleModelOperation(database, native.session, native.lane, accepted.operationId, context, NOW))?.status, "completed");
    assert.deepEqual(await conversation(), { firstQuery: text, title: "Find an anime pilgri" });
  } finally { await native.close(); }
});

void test("an aborted native settlement retains the first query without a default title", async () => {
  const native = await nativeHarness();
  try {
    const accepted = await admitModelRequest(database, native.lane, context, request, options);
    assert.ok(accepted.operationId);
    assert.equal(await prepareOperationSettlement(database, native.session, accepted.operationId, context), true);
    assert.equal((await native.lane.requestAbort(accepted.operationId, context)).ok, true);
    assert.equal((await native.lane.drive({ operationId: accepted.operationId, waitForRetry: false }, context)).ok, true);
    assert.equal((await settleModelOperation(database, native.session, native.lane, accepted.operationId, context, NOW))?.status, "aborted");
    assert.deepEqual(await conversation(), { firstQuery: text, title: null });
  } finally { await native.close(); }
});

void test("native re-admission preserves a user title and the original first query", async () => {
  const native = await nativeHarness();
  try {
    await pool.query("INSERT INTO sessions (id, user_id, title, first_query) VALUES ($1, $2, $3, $4)", [SESSION_ID, IDENTITY, "User rename", "Original query"]);
    const accepted = await admitModelRequest(database, native.lane, context, request, options);
    assert.equal(accepted.kind, "accepted");
    assert.ok(accepted.operationId);
    const replay = await admitModelRequest(database, native.lane, context, request, options);
    assert.equal(replay.kind, "replayed");
    assert.equal(await prepareOperationSettlement(database, native.session, accepted.operationId, context), true);
    assert.equal((await native.lane.drive({ operationId: accepted.operationId }, context)).ok, true);
    assert.equal((await settleModelOperation(database, native.session, native.lane, accepted.operationId, context, NOW))?.status, "completed");
    assert.deepEqual(await conversation(), { firstQuery: "Original query", title: "User rename" });
  } finally { await native.close(); }
});
