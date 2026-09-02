import test from "node:test";
import assert from "node:assert/strict";
import type { RunStatusPayload } from "../spike/pi/src/run-status-view.ts";
import {
  FIVE_MINUTES_MS,
  SESSION_ID,
  SPIKE_DEADLINE_MS,
  TOOL_CALLS,
  TURN_STARTED_AT,
  longTurnRequest,
  makeS4TurnHost,
  runIdOfResponse,
  type S4TurnHost,
} from "./doubles/make-s4-turn-host.ts";

// W0-S4 (#1247) hard condition, spec §四: a deliberate five-minute turn with
// three tool calls runs inside the alarm handler; the client hangs up while it
// is running; the run still ends `succeeded` with a complete transcript, and the
// Durable Object reports the wall-clock it was billed for.
//
// The five minutes are real turn time, not real test time: the tool's hold is
// injected as a `sleep` that only moves the test clock (`AdvancingClock`).
//
// test-type: integration (the host, the state machine, the journal and the run
// store together; only the clock and the database are doubled).

interface FinishedTurn {
  status: RunStatusPayload;
  runId: string;
}

/** Opens the long turn, hangs the client up, then lets the alarm run it out. */
async function runLongTurnAfterHangup(
  world: S4TurnHost,
  overrides: Record<string, number> = {},
): Promise<FinishedTurn> {
  const opened = await world.host.intake.open(longTurnRequest(overrides), SESSION_ID);
  const runId = runIdOfResponse(opened);
  await opened.body?.cancel();
  await world.host.loop.runPending();
  const reported = await world.host.status.report(runId);
  const status: RunStatusPayload = await reported.json();
  return { status, runId };
}

void test("the alarm-hosted five-minute turn ends succeeded after the client hangs up", async () => {
  const { status } = await runLongTurnAfterHangup(makeS4TurnHost());
  assert.equal(status.run.status, "succeeded");
  assert.equal(status.run.failureReason, null);
  assert.equal(status.steps.length, TOOL_CALLS);
  assert.equal(status.toolCalls, TOOL_CALLS);
});

void test("every tool step is written to the run before the turn is settled", async () => {
  const { status } = await runLongTurnAfterHangup(makeS4TurnHost());
  assert.deepEqual(
    status.steps.map((step) => step.stepIndex),
    [0, 1, 2],
  );
  assert.deepEqual(
    status.steps.map((step) => step.result === null),
    [false, false, false],
  );
  assert.deepEqual(new Set(status.steps.map((step) => step.toolName)), new Set(["lookup_spot"]));
});

void test("the transcript the disconnected client comes back to is complete", async () => {
  const { status } = await runLongTurnAfterHangup(makeS4TurnHost());
  assert.deepEqual(
    status.transcript.map((entry) => entry.role),
    ["user", "assistant"],
  );
  const answer = status.transcript[1]?.content ?? "";
  assert.deepEqual(
    [0, 1, 2].map((index) => answer.includes(`step ${String(index)}:`)),
    [true, true, true],
  );
});

void test("the turn is settled and the single-writer lease is handed back", async () => {
  const { status } = await runLongTurnAfterHangup(makeS4TurnHost());
  assert.equal(status.run.finishedAt, new Date(TURN_STARTED_AT + FIVE_MINUTES_MS).toISOString());
  assert.equal(status.run.usageSettledAt, status.run.finishedAt);
  assert.equal(status.run.leaseExpiresAt, null);
  assert.equal(status.run.quotaRefundedAt, null);
});

void test("the turn runs under the spike-only deadline, never a production default", async () => {
  const { status } = await runLongTurnAfterHangup(makeS4TurnHost());
  assert.equal(status.run.deadlineAt, new Date(TURN_STARTED_AT + SPIKE_DEADLINE_MS).toISOString());
  assert.ok(SPIKE_DEADLINE_MS >= 6 * 60_000, "spec §四 S4 floor");
  assert.ok(FIVE_MINUTES_MS >= 5 * 60_000, "spec §四 S4 turn length");
});

void test("the Durable Object reports the wall-clock the alarm was active for", async () => {
  const { status } = await runLongTurnAfterHangup(makeS4TurnHost());
  assert.equal(status.billedMs, FIVE_MINUTES_MS);
});

void test("a shorter hold makes a shorter turn, so the meter measures the turn", async () => {
  const { status } = await runLongTurnAfterHangup(makeS4TurnHost(), { holdMs: 1_000 });
  assert.equal(status.billedMs, 3_000);
  assert.equal(status.run.status, "succeeded");
});

void test("the client that stayed connected receives the turn's frames", async () => {
  const world = makeS4TurnHost();
  const opened = await world.host.intake.open(longTurnRequest(), SESSION_ID);
  const streamed = readFrames(opened);
  await world.host.loop.runPending();
  assert.deepEqual(await streamed, [
    "step_settled",
    "step_settled",
    "step_settled",
    "turn_succeeded",
  ]);
});

async function readFrames(response: Response): Promise<string[]> {
  const body = await new Response(response.body).text();
  return [...body.matchAll(/^event: (.+)$/gm)].map((match) => match[1] ?? "");
}
