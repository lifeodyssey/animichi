/**
 * W1-2 (#1251): what the intake use case does around its one transaction —
 * the turn budget it stamps on the run, the quota reservation it hands the
 * transaction, the backstop it starts before committing anything, and the
 * wake-up that must follow a COMMIT and nothing else.
 *
 * The spec's fast path is "commit, THEN `setAlarm(now)`" (§三): a brand-new
 * run is armed exactly once, and a replay — which committed nothing — arms
 * nothing, because the run it resolved to is already either running or
 * settled. The at-least-once backstop is the RunSweeper, not a second arm, and
 * it has to be ticking before the row exists or it cannot cover the crash
 * between COMMIT and the wake-up.
 *
 * test-type: unit (in-memory ports, injected clock, no database).
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  TURN_DEADLINE_MS,
  acceptTurn,
  type IntakeReceipt,
  type OpenedTurn,
  type TurnIntake,
  type TurnSubmission,
} from "../src/agent/intake/turn-intake.ts";

const NOW = Date.parse("2026-09-02T23:30:00.000Z");
const SESSION = "anon_0123456789abcdef0123456789abcdef";

function makeSubmission(): TurnSubmission {
  return {
    sessionId: SESSION,
    identityId: SESSION,
    payer: "anon",
    clientMessageId: "cmid-1",
    text: "秩父の聖地を回りたい",
  };
}

interface RecordedIntake {
  readonly intake: TurnIntake;
  readonly opened: OpenedTurn[];
  readonly armed: string[][];
  /** Every collaborator call in the order the use case made it. */
  readonly order: string[];
}

/** An intake whose transaction always answers `receipt`, recording every call. */
function makeRecordedIntake(receipt: IntakeReceipt): RecordedIntake {
  const opened: OpenedTurn[] = [];
  const armed: string[][] = [];
  const order: string[] = [];
  return {
    opened,
    armed,
    order,
    intake: {
      backstop: { ensureScheduled: () => { order.push("schedule"); return Promise.resolve(); } },
      records: {
        openTurn: (turn) => { order.push("open"); opened.push(turn); return Promise.resolve(receipt); },
      },
      wakeup: {
        arm: (sessionId, runId) => { order.push("arm"); armed.push([sessionId, runId]); return Promise.resolve(); },
      },
    },
  };
}

const NEW_RUN: IntakeReceipt = { messageId: "m-1", runId: "r-1", replayed: false };
const REPLAYED: IntakeReceipt = { messageId: "m-1", runId: "r-1", replayed: true };

void test("a new run is armed exactly once, with its own session and run id", async () => {
  const recorded = makeRecordedIntake(NEW_RUN);
  await acceptTurn(recorded.intake, makeSubmission(), () => NOW);
  assert.deepEqual(recorded.armed, [[SESSION, "r-1"]]);
});

void test("a replayed client_message_id arms nothing — it committed nothing", async () => {
  const recorded = makeRecordedIntake(REPLAYED);
  const receipt = await acceptTurn(recorded.intake, makeSubmission(), () => NOW);
  assert.deepEqual(recorded.armed, []);
  assert.deepEqual(receipt, REPLAYED);
});

void test("the backstop is ticking before the transaction opens, not after it commits", async () => {
  const recorded = makeRecordedIntake(NEW_RUN);
  await acceptTurn(recorded.intake, makeSubmission(), () => NOW);
  assert.deepEqual(recorded.order, ["schedule", "open", "arm"]);
});

void test("a backstop that cannot be scheduled commits nothing at all", async () => {
  const recorded = makeRecordedIntake(NEW_RUN);
  const intake: TurnIntake = {
    ...recorded.intake,
    backstop: { ensureScheduled: () => Promise.reject(new Error("sweeper unreachable")) },
  };
  await assert.rejects(acceptTurn(intake, makeSubmission(), () => NOW), /sweeper unreachable/);
  assert.deepEqual(recorded.opened, []);
});

void test("the run carries the production whole-turn deadline, measured from the intake clock", async () => {
  const recorded = makeRecordedIntake(NEW_RUN);
  await acceptTurn(recorded.intake, makeSubmission(), () => NOW);
  assert.equal(TURN_DEADLINE_MS, 100_000);
  assert.deepEqual(recorded.opened[0]?.deadlineAt, new Date(NOW + TURN_DEADLINE_MS));
});

void test("the transaction is handed the quota reservation the submission earns", async () => {
  const recorded = makeRecordedIntake(NEW_RUN);
  await acceptTurn(recorded.intake, makeSubmission(), () => NOW);
  assert.deepEqual(recorded.opened[0]?.reservation, { identityId: SESSION, usageDate: "2026-09-02" });
});

void test("a signed-in submission opens a turn with no reservation at all", async () => {
  const recorded = makeRecordedIntake(NEW_RUN);
  const submission = { ...makeSubmission(), payer: "user" as const, identityId: "neon-subject" };
  await acceptTurn(recorded.intake, submission, () => NOW);
  assert.equal(recorded.opened[0]?.reservation, null);
});
