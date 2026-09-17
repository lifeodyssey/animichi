// The chain's `conversation-ledger` operation, proved on the database it migrates: the agent
// tier reaches `sessions` and `turn_reservations` only through raw SQL, so the shapes those
// statements depend on have to be asserted here rather than read off the contract.
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { columnNames, explicitAgentGrants } from "./installed-table.ts";
import { pool } from "./postgres.ts";

const SESSION = "conversation-ledger";
const PAST = "2001-02-03T04:05:06Z";

// The production adoption statement's conflict target is a constraint NAME, so the name — not
// just the column pair — is what this suite has to prove
// (workers/edge/src/identity/session-adoption-store.ts).
const ADOPT_REVISION_CONFLICT = `INSERT INTO turn_reservations (session_id, turn_key, payer, revision, status)
  VALUES ($1, $2, 'anon', $3, 'completed')
  ON CONFLICT ON CONSTRAINT turn_reservations_session_revision DO NOTHING
  RETURNING session_id`;

async function seedConversation(id: string): Promise<void> {
  await pool.query("INSERT INTO sessions (id, user_id, first_query, created_at, updated_at) VALUES ($1, 'owner', 'why', $2, $2)", [id, PAST]);
}

afterEach(async () => {
  await pool.query("DELETE FROM turn_reservations");
  await pool.query("DELETE FROM sessions");
});

void test("the conversation table carries exactly the columns its live readers name", async () => {
  assert.deepEqual(await columnNames(pool, "sessions"),
    ["created_at", "first_query", "id", "title", "updated_at", "user_id"]);
});

void test("the conversation table carries no column the retired Python sweep owned", async () => {
  const retired = ["expires_at", "lifecycle", "metadata", "state"];
  assert.deepEqual((await columnNames(pool, "sessions")).filter((column) => retired.includes(column)), []);
});

void test("updating a conversation advances its updated_at through the shared trigger", async () => {
  await seedConversation(SESSION);
  await pool.query("UPDATE sessions SET title = 'named' WHERE id = $1", [SESSION]);
  const rows = await pool.query<{ advanced: boolean }>("SELECT updated_at > $2 AS advanced FROM sessions WHERE id = $1", [SESSION, PAST]);
  assert.deepEqual(rows.rows, [{ advanced: true }]);
});

void test("the turn ledger carries exactly the columns the adoption statement names", async () => {
  assert.deepEqual(await columnNames(pool, "turn_reservations"),
    ["digest", "id", "identity_id", "payer", "revision", "session_id", "status", "turn_key"]);
});

void test("adoption's named conflict target absorbs a second marker for the same revision", async () => {
  await seedConversation(SESSION);
  const first = await pool.query(ADOPT_REVISION_CONFLICT, [SESSION, "adopt:first", 1]);
  const second = await pool.query(ADOPT_REVISION_CONFLICT, [SESSION, "adopt:second", 1]);
  assert.deepEqual([first.rowCount, second.rowCount], [1, 0]);
});

void test("the turn ledger refuses a payer and a status no admission produces", async () => {
  await seedConversation(SESSION);
  await assert.rejects(pool.query("INSERT INTO turn_reservations (session_id, turn_key, payer, revision) VALUES ($1, 'bad-payer', 'sponsor', 1)", [SESSION]), { code: "23514" });
  await assert.rejects(pool.query("INSERT INTO turn_reservations (session_id, turn_key, payer, revision, status) VALUES ($1, 'bad-status', 'anon', 1, 'queued')", [SESSION]), { code: "23514" });
});

void test("the agent service holds exactly the ledger grants migrations/neon granted it", async () => {
  assert.deepEqual(await explicitAgentGrants(pool, "sessions"), ["DELETE", "INSERT", "SELECT", "UPDATE"]);
  assert.deepEqual(await explicitAgentGrants(pool, "turn_reservations"), ["DELETE", "INSERT", "SELECT", "UPDATE"]);
});
