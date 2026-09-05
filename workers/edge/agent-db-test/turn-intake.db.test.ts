/**
 * W1-2 (#1251) against real PostgreSQL: the intake's transaction, proven on
 * the committed `migrations/neon` chain rather than on a double.
 *
 * Three properties can only be told the truth by a database. Dedupe is a partial
 * unique index (`messages_session_client_message_id`), so a replay must leave
 * the row COUNTS unchanged, not merely return the same ids. Atomicity is the
 * transaction itself, so a failure injected between the message insert and the
 * run insert must leave neither — and no quota reservation either. And the
 * conversation the message hangs off is a foreign key: the intake opens that row
 * itself (#1256), so no case here seeds one.
 *
 * test-type: integration (disposable Docker PostgreSQL, committed Atlas chain).
 */
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { sql } from "drizzle-orm";
import {
  acceptTurn,
  SessionBusyError,
  SessionOwnershipError,
  type TurnIntake,
  type TurnRecords,
} from "../src/agent/intake/turn-intake.ts";
import { NeonTurnRecords } from "../src/agent/intake/neon-turn-records.ts";
import type { AgentStatements, AgentTransactions } from "../src/db/agent-database.ts";
import type { SessionWakeup } from "../src/agent/session/session-wakeup.ts";
import { SETUP_HOOK_TIMEOUT_MS, startAgentDataPlane, type AgentDataPlane } from "./postgres-arm.ts";
import { countRows, makeSubmission, onlyRow, reservedCount, seedSession } from "./agent-rows.ts";

const ANON_ID = "anon_0123456789abcdef0123456789abcdef";
const NOW = Date.parse("2026-09-02T23:30:00.000Z");
const NEVER_ARMED: SessionWakeup = { arm: () => Promise.resolve() };

/** The real records under test, with the Durable Object collaborators stubbed:
 * this lane is about what the transaction leaves in PostgreSQL. */
function makeIntake(records: TurnRecords): TurnIntake {
  return { backstop: { ensureScheduled: () => Promise.resolve() }, records, wakeup: NEVER_ARMED };
}

let plane: AgentDataPlane;

before(async () => { plane = await startAgentDataPlane(); }, { timeout: SETUP_HOOK_TIMEOUT_MS });
after(() => plane.stop(), { timeout: 60_000 });

/** Transactions whose second statement — the run insert — always fails. */
function makeTransactionsFailingAfterTheMessage(inner: AgentTransactions): AgentTransactions {
  return {
    run: (work) => inner.run((statements) => work(failingAfterOneStatement(statements))),
  };
}

function failingAfterOneStatement(statements: AgentStatements): AgentStatements {
  let executed = 0;
  return {
    execute: (query) => {
      executed += 1;
      return executed > 1
        ? Promise.reject(new Error("injected mid-transaction failure"))
        : statements.execute(query);
    },
  };
}

void test("a replayed client_message_id resolves to the same turn and writes nothing new", async () => {
  const submission = makeSubmission({ sessionId: "replay-session" });
  const records = new NeonTurnRecords(plane.transactions);
  const first = await acceptTurn(makeIntake(records), submission, () => NOW);
  const messagesBefore = await countRows(plane.database, "messages");
  const replay = await acceptTurn(makeIntake(records), submission, () => NOW);
  assert.deepEqual(replay, { messageId: first.messageId, runId: first.runId, replayed: true });
  assert.equal(await countRows(plane.database, "messages"), messagesBefore);
});

void test("a replay reserves no second message on the daily quota counter", async () => {
  const identityId = "anon_00000000000000000000000000000002";
  const submission = makeSubmission({ sessionId: "replay-quota-session", identityId, clientMessageId: "cmid-quota" });
  const records = new NeonTurnRecords(plane.transactions);
  await acceptTurn(makeIntake(records), submission, () => NOW);
  const reservedOnce = await reservedCount(plane.database, identityId);
  await acceptTurn(makeIntake(records), submission, () => NOW);
  assert.equal(reservedOnce, 1);
  assert.equal(await reservedCount(plane.database, identityId), 1);
});

void test("a failure between the message insert and the run insert leaves no partial rows", async () => {
  const submission = makeSubmission({ sessionId: "atomic-session", clientMessageId: "cmid-atomic" });
  const records = new NeonTurnRecords(makeTransactionsFailingAfterTheMessage(plane.transactions));
  const messagesBefore = await countRows(plane.database, "messages");
  const runsBefore = await countRows(plane.database, "runs");
  await assert.rejects(acceptTurn(makeIntake(records), submission, () => NOW), /injected mid-transaction/);
  assert.equal(await countRows(plane.database, "messages"), messagesBefore);
  assert.equal(await countRows(plane.database, "runs"), runsBefore);
});

void test("the rolled-back turn also left no quota reservation behind", async () => {
  const identityId = "anon_00000000000000000000000000000001";
  const submission = makeSubmission({ sessionId: "atomic-quota-session", identityId, clientMessageId: "cmid-aq" });
  const records = new NeonTurnRecords(makeTransactionsFailingAfterTheMessage(plane.transactions));
  await assert.rejects(acceptTurn(makeIntake(records), submission, () => NOW), /injected mid-transaction/);
  assert.equal(await reservedCount(plane.database, identityId), 0);
});

void test("a second turn on a session that is already running loses on admission", async () => {
  const submission = makeSubmission({ sessionId: "busy-session", clientMessageId: "cmid-busy-1" });
  const records = new NeonTurnRecords(plane.transactions);
  await acceptTurn(makeIntake(records), submission, () => NOW);
  const second = acceptTurn(makeIntake(records), { ...submission, clientMessageId: "cmid-busy-2" }, () => NOW);
  await assert.rejects(second, (error: unknown) => error instanceof SessionBusyError && error.reason === "running_turn");
});

/** One run's committed columns. The deadline comes back as epoch
 * milliseconds: drizzle hands a timestamptz to its caller as the driver's own
 * text (`workers/users/AGENTS.md`), and an instant compares without a format. */
async function committedRun(runId: string): Promise<Record<string, unknown>> {
  const committed = await plane.database.execute(
    sql`select status, (extract(epoch from deadline_at) * 1000)::bigint::text as deadline_ms,
               payer, quota_identity_id, quota_usage_date::text as quota_usage_date
        from runs where id = ${runId}`,
  );
  const row = onlyRow(committed);
  return { ...row, deadline_ms: Number(row.deadline_ms) };
}

void test("a dedupe key whose message has no run is refused, not turned into a second run", async () => {
  const submission = makeSubmission({ sessionId: "orphan-session", clientMessageId: "cmid-orphan" });
  const records = new NeonTurnRecords(plane.transactions);
  const first = await acceptTurn(makeIntake(records), submission, () => NOW);
  await plane.database.execute(sql`delete from runs where id = ${first.runId}`);
  const replay = acceptTurn(makeIntake(records), submission, () => NOW);
  await assert.rejects(replay, (error: unknown) => error instanceof SessionBusyError && error.reason === "orphaned_replay");
});

void test("the committed run carries the turn deadline and the reservation coordinates", async () => {
  const submission = makeSubmission({ sessionId: "coordinates-session", clientMessageId: "cmid-coords" });
  const receipt = await acceptTurn(makeIntake(new NeonTurnRecords(plane.transactions)), submission, () => NOW);
  assert.deepEqual(await committedRun(receipt.runId), {
    status: "running",
    deadline_ms: NOW + 100_000,
    payer: "anon",
    quota_identity_id: ANON_ID,
    quota_usage_date: "2026-09-02",
  });
});

void test("the first turn of a conversation opens it and claims it for the submitter", async () => {
  const submission = makeSubmission({ sessionId: "opened-session", clientMessageId: "cmid-open" });
  await acceptTurn(makeIntake(new NeonTurnRecords(plane.transactions)), submission, () => NOW);
  const owner = await plane.database.execute(
    sql`select user_id from sessions where id = ${submission.sessionId}`,
  );
  assert.equal(onlyRow(owner).user_id, ANON_ID);
});

void test("a conversation another identity owns is refused before any row is written", async () => {
  const submission = makeSubmission({ sessionId: "someone-elses-session", clientMessageId: "cmid-theirs" });
  await seedSession(plane.database, submission.sessionId, "anon_ffffffffffffffffffffffffffffffff");
  const records = new NeonTurnRecords(plane.transactions);
  const messagesBefore = await countRows(plane.database, "messages");
  await assert.rejects(
    acceptTurn(makeIntake(records), submission, () => NOW),
    (error: unknown) => error instanceof SessionOwnershipError,
  );
  assert.equal(await countRows(plane.database, "messages"), messagesBefore);
});
