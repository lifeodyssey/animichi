import test, { after } from "node:test";
import assert from "node:assert/strict";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { PostgresRunStore } from "../spike/pi/src/postgres-run-store.ts";
import type { TurnIdentity } from "../spike/pi/src/run-store.ts";

// W0-S4 (#1247): `PostgresRunStore` against a REAL PostgreSQL carrying the
// migrations/neon chain, so the invariants the unit tests lean on are the
// database's invariants and not the double's opinion of them:
// runs_one_running_per_session (the 409), the (run_id, step_index) primary key
// (the replay), run_steps_settled_check, runs_lease_within_deadline_check and
// the exactly-once quota refund marker.
//
// Opt-in lane (`pnpm run test:spike-db`), never `pnpm test`: it needs a
// disposable database and fails closed without one. The recipe for spinning one
// is in workers/edge/spike/pi/README.md; never point it at staging.
//
// test-type: integration (real database, real SQL; no clock, no network).

const CONNECTION = process.env.SPIKE_TEST_DATABASE_URL;
assert.ok(
  CONNECTION,
  "SPIKE_TEST_DATABASE_URL must name a DISPOSABLE PostgreSQL carrying migrations/neon " +
    "(see workers/edge/spike/pi/README.md); this lane never runs against staging",
);

const pool = new Pool({ connectionString: CONNECTION });
const store = new PostgresRunStore(drizzle(pool));
const AT = new Date("2026-09-03T09:00:00.000Z");
const DEADLINE = new Date("2026-09-03T09:07:00.000Z");

after(async () => {
  await pool.end();
});

function makeTurn(label: string): TurnIdentity {
  return {
    runId: crypto.randomUUID(),
    sessionId: `spike-s4-${label}-${crypto.randomUUID()}`,
    userMessageId: crypto.randomUUID(),
    assistantMessageId: crypto.randomUUID(),
  };
}

function nextTurnOn(turn: TurnIdentity): TurnIdentity {
  return { ...makeTurn("next"), sessionId: turn.sessionId };
}

/** Drizzle wraps the driver error, so the constraint name is on the cause. */
function violatesConstraint(name: string) {
  return (error: unknown) => String(error instanceof Error ? error.cause : error).includes(name);
}

function stepOf(index: number, text: string) {
  return { stepIndex: index, toolName: "lookup_spot", input: { title: "Hyouka" }, result: { text } };
}

async function openedTurn(label: string): Promise<TurnIdentity> {
  const turn = makeTurn(label);
  assert.equal(await store.openTurn(turn, "prompt", DEADLINE), "opened");
  return turn;
}

void test("a session may hold only one running run at a time", async () => {
  const turn = await openedTurn("busy");
  assert.equal(await store.openTurn(nextTurnOn(turn), "prompt", DEADLINE), "session_busy");
});

void test("the one-running-run index is partial, so a settled session reopens", async () => {
  const turn = await openedTurn("reopen");
  assert.equal(await store.completeTurn(turn, "answer", AT), true);
  assert.equal(await store.openTurn(nextTurnOn(turn), "prompt", DEADLINE), "opened");
});

void test("a step is keyed by (run_id, step_index) and a rewrite leaves it alone", async () => {
  const turn = await openedTurn("step-key");
  await store.settleStep(turn.runId, stepOf(0, "first"), AT);
  await store.settleStep(turn.runId, stepOf(0, "second"), AT);
  const steps = await store.loadSteps(turn.runId);
  assert.deepEqual(steps, [{ stepIndex: 0, toolName: "lookup_spot", input: { title: "Hyouka" }, result: { text: "first" } }]);
});

void test("settled steps come back in step order with their jsonb parsed", async () => {
  const turn = await openedTurn("step-order");
  await store.settleStep(turn.runId, stepOf(2, "third"), AT);
  await store.settleStep(turn.runId, stepOf(0, "first"), AT);
  await store.settleStep(turn.runId, stepOf(1, "second"), AT);
  const steps = await store.loadSteps(turn.runId);
  assert.deepEqual(steps.map((step) => step.stepIndex), [0, 1, 2]);
  assert.deepEqual(steps.map((step) => step.result?.text), ["first", "second", "third"]);
});

void test("completing a turn writes the assistant message and settles the run", async () => {
  const turn = await openedTurn("complete");
  assert.equal(await store.completeTurn(turn, "the answer", AT), true);
  const run = await store.readRun(turn.runId);
  assert.ok(run);
  assert.equal(run.status, "succeeded");
  assert.equal(run.leaseExpiresAt, null);
  assert.deepEqual(await store.readTranscript(turn.sessionId), [
    { role: "user", content: "prompt" },
    { role: "assistant", content: "the answer" },
  ]);
});

void test("a second settlement of the same run changes nothing", async () => {
  const turn = await openedTurn("resettle");
  assert.equal(await store.completeTurn(turn, "the answer", AT), true);
  assert.equal(await store.completeTurn(turn, "a different answer", AT), false);
  assert.deepEqual((await store.readTranscript(turn.sessionId)).length, 2);
});

void test("a failed turn records its reason and refunds the reservation once", async () => {
  const turn = await openedTurn("fail");
  assert.deepEqual(await store.failTurn(turn.runId, "tool_failed", AT), { settled: true, refunded: true });
  assert.deepEqual(await store.failTurn(turn.runId, "tool_failed", AT), { settled: false, refunded: false });
  const run = await store.readRun(turn.runId);
  assert.ok(run);
  assert.equal(run.failureReason, "tool_failed");
  assert.notEqual(run.quotaRefundedAt, null);
});

void test("a lease renewal is clamped at the deadline the CHECK constrains it to", async () => {
  const turn = await openedTurn("lease");
  await store.renewLease(turn.runId, "owner-1", new Date(DEADLINE.getTime() + 60_000));
  const run = await store.readRun(turn.runId);
  assert.ok(run);
  assert.equal(run.leaseExpiresAt, run.deadlineAt);
});

void test("a lease inside the deadline is taken as asked", async () => {
  const turn = await openedTurn("lease-inside");
  await store.renewLease(turn.runId, "owner-1", new Date(DEADLINE.getTime() - 60_000));
  const run = await store.readRun(turn.runId);
  assert.ok(run);
  assert.notEqual(run.leaseExpiresAt, run.deadlineAt);
  assert.equal(await store.completeTurn(turn, "answer", AT), true);
});

void test("a conflict that is not the busy-session index is raised, not swallowed", async () => {
  const turn = await openedTurn("target");
  assert.equal(await store.completeTurn(turn, "answer", AT), true);
  const duplicate = { ...makeTurn("target-dup"), sessionId: turn.sessionId, userMessageId: turn.userMessageId };
  await assert.rejects(
    store.openTurn(duplicate, "prompt", DEADLINE),
    violatesConstraint("runs_message_id_key"),
  );
});

void test("an unknown run has no report", async () => {
  assert.equal(await store.readRun(crypto.randomUUID()), null);
});
