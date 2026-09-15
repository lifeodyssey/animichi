import assert from "node:assert/strict";
import { test } from "node:test";
import { ListConversationsResponse } from "@animichi/contract/session-history-contract";
import { admitModelRequest } from "../src/agent/admission/admit-model-request.ts";
import { prepareOperationSettlement, settleModelOperation } from "../src/agent/settlement/native-settlement.ts";
import { listConversations } from "../src/agent/views/conversation-list.ts";
import { context, nativeHarness } from "./harness.ts";
import { database, IDENTITY, NOW, pool, SESSION_ID } from "./postgres.ts";

// The conversation list read against real PostgreSQL (Card E of the #1317
// decomposition): the 30-row cap, `updated_at DESC`, and `user_id` scoping.
// It belongs to this lane because the `sessions` rows it reads are the rows
// admission writes — the title case at the bottom drives the whole native
// admission → settlement path and then reads the list back.
//
// Isolation is per-owner: every hand-inserted row carries a `list-` owner and
// each case clears those rows first, so cases never see each other's fixtures
// or a previous run's leftovers.

const TEXT = "Find an anime pilgrimage in Tokyo";

async function clearListRows() {
  await pool.query("DELETE FROM sessions WHERE user_id LIKE 'list-%'");
}

function insertSession(id: string, owner: string, updatedAt: string, title: string | null = null) {
  return pool.query(
    "INSERT INTO sessions (id, user_id, title, first_query, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $5)",
    [id, owner, title, `query for ${id}`, updatedAt],
  );
}

void test("the list is the caller's newest 30 rows and drops everything beyond the cap", async () => {
  await clearListRows();
  await pool.query("INSERT INTO sessions (id, user_id, first_query, created_at, updated_at) SELECT 'list-cap-' || lpad(n::text, 2, '0'), 'list-cap', 'query ' || n, TIMESTAMPTZ '2026-09-10T00:00:00Z' + n * INTERVAL '1 second', TIMESTAMPTZ '2026-09-10T00:00:00Z' + n * INTERVAL '1 second' FROM generate_series(1, 31) AS n");
  // Someone else's row, newer than every owned one: without the `user_id`
  // predicate it would enter the newest-30 window and this case would go red
  // on its own, not only the scoping case below.
  await insertSession("list-other-newest", "list-other", "2026-09-10T00:01:00Z");

  const rows = await listConversations(database, "list-cap");
  const newestFirst = Array.from({ length: 30 }, (_, index) => `list-cap-${String(31 - index).padStart(2, "0")}`);
  assert.deepEqual(rows.map((row) => row.session_id), newestFirst);
  assert.equal(rows.some((row) => row.session_id === "list-cap-01"), false, "the 31st row is beyond the cap");
  assert.deepEqual(ListConversationsResponse.parse(rows), rows, "every live row satisfies the declared body");
});

void test("the list carries the caller's rows and never another user's, in either direction", async () => {
  await clearListRows();
  await insertSession("list-mine-1", "list-mine", "2026-09-10T00:00:01Z");
  await insertSession("list-mine-2", "list-mine", "2026-09-10T00:00:02Z");
  await insertSession("list-theirs-1", "list-theirs", "2026-09-10T00:00:03Z");
  await insertSession("list-theirs-2", "list-theirs", "2026-09-10T00:00:04Z");

  const mine = await listConversations(database, "list-mine");
  const theirs = await listConversations(database, "list-theirs");
  assert.deepEqual(mine.map((row) => row.session_id), ["list-mine-2", "list-mine-1"]);
  assert.deepEqual(theirs.map((row) => row.session_id), ["list-theirs-2", "list-theirs-1"]);
  assert.deepEqual(await listConversations(database, "list-nobody"), [], "no conversations is an empty list, never a leak");
});

void test("a conversation the native tier admitted lists untitled, then titled once it settles", async () => {
  const native = await nativeHarness();
  try {
    const request = { sessionId: SESSION_ID, identityId: IDENTITY, payer: "anon", locale: "en", clientMessageId: "list-title", text: TEXT } as const;
    const accepted = await admitModelRequest(database, native.lane, context, request, { anonymousAllowance: 1, now: NOW });
    assert.ok(accepted.operationId);
    const admitted = await listConversations(database, IDENTITY);
    assert.deepEqual(admitted.map(({ session_id, title, first_query }) => ({ session_id, title, first_query })), [
      { session_id: SESSION_ID, title: null, first_query: TEXT },
    ], "admission wrote the first query; the title arrives only with the first successful settlement");
    assert.deepEqual(admitted.map((row) => typeof row.created_at), ["string"], "the row carries the table's own created_at");
    assert.deepEqual(admitted.map((row) => typeof row.updated_at), ["string"], "the row carries the table's own updated_at");

    assert.equal(await prepareOperationSettlement(database, native.session, accepted.operationId, context), true);
    assert.equal((await native.lane.drive({ operationId: accepted.operationId }, context)).ok, true);
    assert.equal((await settleModelOperation(database, native.session, native.lane, accepted.operationId, context, NOW))?.status, "completed");
    const settled = await listConversations(database, IDENTITY);
    assert.deepEqual(settled.map(({ session_id, title, first_query }) => ({ session_id, title, first_query })), [
      { session_id: SESSION_ID, title: "Find an anime pilgri", first_query: TEXT },
    ]);
  } finally { await native.close(); }
});
