import assert from "node:assert/strict";
import { after, test } from "node:test";
import { nativeClient } from "../src/native-client.ts";
import { createOrLockOwnedConversation, setDefaultConversationTitle } from "../src/agent/admission/session-owner.ts";
import type { AdmissionTransaction } from "../src/agent/admission/types.ts";

const database = nativeClient("postgres://unit:unit@127.0.0.1:1/unit");
const request = { sessionId: "session", identityId: "owner", text: "New query" };

after(async () => database.close());

void test("the session upsert conflict path cannot assign a user title", async () => {
  let queryPlan: unknown;
  const transaction = { query: (plan: unknown) => {
    queryPlan = plan;
    return Promise.resolve([{ owner: request.identityId }]);
  } } as unknown as AdmissionTransaction;

  assert.equal(await createOrLockOwnedConversation(database, transaction, request), true);
  const sql = JSON.stringify(queryPlan);
  assert.match(sql, /INSERT INTO sessions \(id,\s+user_id,\s+first_query\)/);
  assert.match(sql, /ON CONFLICT \(id\) DO UPDATE SET user_id = sessions\.user_id/);
  assert.doesNotMatch(sql, /DO UPDATE SET[^]*title/);
});

// The read side this card moved (`GET /v1/conversations`) lists `title` and
// `first_query` rather than deriving one from the other, so the writer those
// columns come from is pinned here too: #1608 fills the title only after a
// successful first response, only from the stored first query, and never over
// a title the reader can set.
void test("the default title is the stored first query's first 20 characters, and only while unset", async () => {
  let queryPlan: unknown;
  const transaction = { execute: (plan: unknown) => {
    queryPlan = plan;
    return Promise.resolve();
  } } as unknown as AdmissionTransaction;

  await setDefaultConversationTitle(database, transaction, request.sessionId);
  const sql = JSON.stringify(queryPlan);
  assert.match(sql, /UPDATE sessions SET title = LEFT\(first_query, 20\)/);
  assert.match(sql, /WHERE id = /);
  assert.match(sql, /AND title IS NULL AND first_query IS NOT NULL/);
  assert.ok(sql.includes(`"value":"${request.sessionId}"`), "only the conversation being settled is titled");
});
