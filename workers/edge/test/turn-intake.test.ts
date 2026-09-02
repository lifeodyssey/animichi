/**
 * W1-2 (#1251): what the intake use case does around its one transaction —
 * the turn budget it stamps on the run, the quota reservation it hands the
 * transaction, and the wake-up that must follow a COMMIT and nothing else.
 *
 * The spec's fast path is "commit, THEN `setAlarm(now)`" (§三): a brand-new
 * run is armed exactly once, and a replay — which committed nothing — arms
 * nothing, because the run it resolved to is already either running or
 * settled. The at-least-once backstop is the RunSweeper, not a second arm.
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
  type TurnRecords,
  type TurnSubmission,
} from "../src/agent/intake/turn-intake.ts";
import type { SessionWakeup } from "../src/agent/session/session-wakeup.ts";

const NOW = Date.parse("2026-09-02T23:30:00.000Z");

function makeSubmission(): TurnSubmission {
  return {
    sessionId: "anon_0123456789abcdef0123456789abcdef",
    identityId: "anon_0123456789abcdef0123456789abcdef",
    payer: "anon",
    clientMessageId: "cmid-1",
    text: "秩父の聖地を回りたい",
  };
}

/** Records that always answer with `receipt`, keeping what it was asked to open. */
function makeRecords(receipt: IntakeReceipt): TurnRecords & { opened: OpenedTurn[] } {
  const opened: OpenedTurn[] = [];
  return {
    opened,
    openTurn(turn) {
      opened.push(turn);
      return Promise.resolve(receipt);
    },
  };
}

/** A wake-up that records every arm it is asked for. */
function makeRecordingWakeup(): SessionWakeup & { armed: string[][] } {
  const armed: string[][] = [];
  return {
    armed,
    arm(sessionId, runId) {
      armed.push([sessionId, runId]);
      return Promise.resolve();
    },
  };
}

const NEW_RUN: IntakeReceipt = { messageId: "m-1", runId: "r-1", replayed: false };
const REPLAYED: IntakeReceipt = { messageId: "m-1", runId: "r-1", replayed: true };

void test("a new run is armed exactly once, with its own session and run id", async () => {
  const wakeup = makeRecordingWakeup();
  await acceptTurn(makeRecords(NEW_RUN), wakeup, makeSubmission(), () => NOW);
  assert.deepEqual(wakeup.armed, [["anon_0123456789abcdef0123456789abcdef", "r-1"]]);
});

void test("a replayed client_message_id arms nothing — it committed nothing", async () => {
  const wakeup = makeRecordingWakeup();
  const receipt = await acceptTurn(makeRecords(REPLAYED), wakeup, makeSubmission(), () => NOW);
  assert.deepEqual(wakeup.armed, []);
  assert.deepEqual(receipt, REPLAYED);
});

void test("the run carries the production whole-turn deadline, measured from the intake clock", async () => {
  const records = makeRecords(NEW_RUN);
  await acceptTurn(records, makeRecordingWakeup(), makeSubmission(), () => NOW);
  assert.equal(TURN_DEADLINE_MS, 100_000);
  assert.deepEqual(records.opened[0]?.deadlineAt, new Date(NOW + TURN_DEADLINE_MS));
});

void test("the transaction is handed the quota reservation the submission earns", async () => {
  const records = makeRecords(NEW_RUN);
  await acceptTurn(records, makeRecordingWakeup(), makeSubmission(), () => NOW);
  assert.deepEqual(records.opened[0]?.reservation, {
    identityId: "anon_0123456789abcdef0123456789abcdef",
    usageDate: "2026-09-02",
  });
});

void test("a signed-in submission opens a turn with no reservation at all", async () => {
  const records = makeRecords(NEW_RUN);
  const submission = { ...makeSubmission(), payer: "user" as const, identityId: "neon-subject" };
  await acceptTurn(records, makeRecordingWakeup(), submission, () => NOW);
  assert.equal(records.opened[0]?.reservation, null);
});
