import assert from "node:assert/strict";
import { after, test } from "node:test";
import type { ConversationListRow } from "@animichi/contract/session-history-contract";
import { ListConversationsResponse } from "@animichi/contract/session-history-contract";
import type { AdmissionDatabase } from "../src/agent/admission/types.ts";
import { nativeClient } from "../src/native-client.ts";
import { listConversations } from "../src/agent/views/conversation-list.ts";

// The list's scope, order and cap are pinned twice on purpose: here the
// statement is read back with no server, and
// `admission-test/conversation-list.test.ts` proves the same three properties
// against real PostgreSQL, where the semantics actually live. A dropped
// `user_id` predicate is red in both lanes.

const client = nativeClient("postgres://unit:unit@127.0.0.1:1/unit");
after(async () => { await client.close(); });

/** A row the native tier admitted but has not settled yet: #1608 writes the
 * title only after the first successful response, so it is still null. */
const ADMITTED_ROW: ConversationListRow = {
  session_id: "s-1", title: null, first_query: "Where is the bench?", created_at: null, updated_at: null,
};

/** A row from before #1608 wrote either column: both string columns are null. */
const PRE_1608_ROW: ConversationListRow = {
  session_id: "s-0", title: null, first_query: null, created_at: null, updated_at: null,
};

/** A database whose runtime answers with `rows` and records the plan it ran. */
function recordingDatabase(rows: ConversationListRow[], plans: unknown[]): AdmissionDatabase {
  return {
    raw: client.raw,
    runtime: () => ({ query: (plan: unknown) => { plans.push(plan); return Promise.resolve(rows); } }),
  } as unknown as AdmissionDatabase;
}

/** The plan the statement emitted, and the rows the runtime answered with. */
async function listPlanAndRows(rows: ConversationListRow[], identityId: string) {
  const plans: unknown[] = [];
  const answered = await listConversations(recordingDatabase(rows, plans), identityId);
  return { sql: JSON.stringify(plans[0]), rows: answered };
}

void test("the list statement is the caller's own rows, newest first, capped at 30", async () => {
  const { sql } = await listPlanAndRows([], "user-1");
  assert.ok(sql.includes("FROM sessions WHERE user_id = "), "the ownership predicate is what scopes the list");
  assert.ok(sql.includes('"value":"user-1"'), "the predicate is bound to the verified identity, not to input");
  assert.ok(sql.includes(" ORDER BY updated_at DESC NULLS LAST"), "the sidebar's first row is the conversation touched last, and a null timestamp never leads it");
  assert.ok(sql.includes(" LIMIT "), "a capped read, not the whole table");
  assert.ok(sql.includes('"value":30'), "the 30-row window kept verbatim from the retired list_sessions");
});

void test("the declared row is the contract's five columns, nulls included", async () => {
  const { sql } = await listPlanAndRows([], "user-1");
  assert.ok(sql.includes('"session_id":{"codecId":"'), "session_id must be part of the declared row");
  assert.ok(sql.includes('"title":{"codecId":"'), "title must be part of the declared row");
  assert.ok(sql.includes('"first_query":{"codecId":"'), "first_query must be part of the declared row");
  assert.ok(sql.includes('"created_at":{"codecId":"'), "created_at must be part of the declared row");
  assert.ok(sql.includes('"updated_at":{"codecId":"'), "updated_at must be part of the declared row");
  assert.ok(sql.includes('"session_id":{"codecId":"pg/text@1","nullable":false}'), "a session id is never null");
  assert.ok(sql.includes('"title":{"codecId":"pg/text@1","nullable":true}'), "a conversation exists before its title does");
  assert.ok(sql.includes('"first_query":{"codecId":"pg/text@1","nullable":true}'), "first_query is null for pre-#1608 rows");
  assert.ok(sql.includes('"updated_at":{"codecId":"pg/timestamptz-string@1","nullable":true}'), "the ordering column can be null in the table");
});

void test("a row's nulls stay nulls: the sidebar's own title fallback is not re-derived here", async () => {
  const { rows } = await listPlanAndRows([ADMITTED_ROW], "user-1");
  assert.deepEqual(rows, [ADMITTED_ROW]);
});

void test("the contract's declared body admits every null this statement can read", () => {
  const rows = [ADMITTED_ROW, PRE_1608_ROW];
  assert.deepEqual(ListConversationsResponse.parse(rows), rows);
});
