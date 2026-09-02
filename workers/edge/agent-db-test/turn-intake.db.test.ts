/**
 * W1-2 (#1251) against real PostgreSQL: the intake's transaction, proven on
 * the committed `migrations/neon` chain rather than on a double.
 *
 * Two properties can only be told the truth by a database. Dedupe is a partial
 * unique index (`messages_session_client_message_id`), so a replay must leave
 * the row COUNTS unchanged, not merely return the same ids. Atomicity is the
 * transaction itself, so a failure injected between the message insert and the
 * run insert must leave neither — and no quota reservation either.
 *
 * test-type: integration (disposable Docker PostgreSQL, committed Atlas chain).
 */
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { sql } from "drizzle-orm";
import { acceptTurn, SessionBusyError } from "../src/agent/intake/turn-intake.ts";
import { NeonTurnRecords } from "../src/agent/intake/neon-turn-records.ts";
import type { AgentStatements, AgentTransactions } from "../src/db/agent-database.ts";
import type { SessionWakeup } from "../src/agent/session/session-wakeup.ts";
import { startAgentDataPlane, type AgentDataPlane } from "./postgres-arm.ts";
import { countRows, makeSubmission, onlyRow, reservedCount, seedSession } from "./agent-rows.ts";

const ANON_ID = "anon_0123456789abcdef0123456789abcdef";
const NOW = Date.parse("2026-09-02T23:30:00.000Z");
const NEVER_ARMED: SessionWakeup = { arm: () => Promise.resolve() };

let plane: AgentDataPlane;

before(async () => { plane = await startAgentDataPlane(); }, { timeout: 300_000 });
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
  await seedSession(plane.database, submission.sessionId);
  const records = new NeonTurnRecords(plane.transactions);
  const first = await acceptTurn(records, NEVER_ARMED, submission, () => NOW);
  const messagesBefore = await countRows(plane.database, "messages");
  const replay = await acceptTurn(records, NEVER_ARMED, submission, () => NOW);
  assert.deepEqual(replay, { messageId: first.messageId, runId: first.runId, replayed: true });
  assert.equal(await countRows(plane.database, "messages"), messagesBefore);
});

void test("a replay reserves no second message on the daily quota counter", async () => {
  const identityId = "anon_00000000000000000000000000000002";
  const submission = makeSubmission({ sessionId: "replay-quota-session", identityId, clientMessageId: "cmid-quota" });
  await seedSession(plane.database, submission.sessionId);
  const records = new NeonTurnRecords(plane.transactions);
  await acceptTurn(records, NEVER_ARMED, submission, () => NOW);
  const reservedOnce = await reservedCount(plane.database, identityId);
  await acceptTurn(records, NEVER_ARMED, submission, () => NOW);
  assert.equal(reservedOnce, 1);
  assert.equal(await reservedCount(plane.database, identityId), 1);
});

void test("a failure between the message insert and the run insert leaves no partial rows", async () => {
  const submission = makeSubmission({ sessionId: "atomic-session", clientMessageId: "cmid-atomic" });
  await seedSession(plane.database, submission.sessionId);
  const records = new NeonTurnRecords(makeTransactionsFailingAfterTheMessage(plane.transactions));
  const messagesBefore = await countRows(plane.database, "messages");
  const runsBefore = await countRows(plane.database, "runs");
  await assert.rejects(acceptTurn(records, NEVER_ARMED, submission, () => NOW), /injected mid-transaction/);
  assert.equal(await countRows(plane.database, "messages"), messagesBefore);
  assert.equal(await countRows(plane.database, "runs"), runsBefore);
});

void test("the rolled-back turn also left no quota reservation behind", async () => {
  const identityId = "anon_00000000000000000000000000000001";
  const submission = makeSubmission({ sessionId: "atomic-quota-session", identityId, clientMessageId: "cmid-aq" });
  await seedSession(plane.database, submission.sessionId);
  const records = new NeonTurnRecords(makeTransactionsFailingAfterTheMessage(plane.transactions));
  await assert.rejects(acceptTurn(records, NEVER_ARMED, submission, () => NOW), /injected mid-transaction/);
  assert.equal(await reservedCount(plane.database, identityId), 0);
});

void test("a second turn on a session that is already running loses on admission", async () => {
  const submission = makeSubmission({ sessionId: "busy-session", clientMessageId: "cmid-busy-1" });
  await seedSession(plane.database, submission.sessionId);
  const records = new NeonTurnRecords(plane.transactions);
  await acceptTurn(records, NEVER_ARMED, submission, () => NOW);
  const second = acceptTurn(records, NEVER_ARMED, { ...submission, clientMessageId: "cmid-busy-2" }, () => NOW);
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
  await seedSession(plane.database, submission.sessionId);
  const records = new NeonTurnRecords(plane.transactions);
  const first = await acceptTurn(records, NEVER_ARMED, submission, () => NOW);
  await plane.database.execute(sql`delete from runs where id = ${first.runId}`);
  const replay = acceptTurn(records, NEVER_ARMED, submission, () => NOW);
  await assert.rejects(replay, (error: unknown) => error instanceof SessionBusyError && error.reason === "orphaned_replay");
});

void test("the committed run carries the turn deadline and the reservation coordinates", async () => {
  const submission = makeSubmission({ sessionId: "coordinates-session", clientMessageId: "cmid-coords" });
  await seedSession(plane.database, submission.sessionId);
  const receipt = await acceptTurn(new NeonTurnRecords(plane.transactions), NEVER_ARMED, submission, () => NOW);
  assert.deepEqual(await committedRun(receipt.runId), {
    status: "running",
    deadline_ms: NOW + 100_000,
    payer: "anon",
    quota_identity_id: ANON_ID,
    quota_usage_date: "2026-09-02",
  });
});
