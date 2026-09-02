import test from "node:test";
import assert from "node:assert/strict";
import type { RunStatusPayload } from "../spike/pi/src/run-status-view.ts";
import { InjectedCrash } from "../spike/pi/src/turn-step.ts";
import {
  SESSION_ID,
  TOOL_CALLS,
  longTurnRequest,
  makeS4TurnHost,
  runIdOfResponse,
  type S4TurnHost,
} from "./doubles/make-s4-turn-host.ts";

// W0-S4 (#1247) recovery matrix, spec §四 S4: a concurrent turn on the same
// session, an eviction/restart in the middle of one, and a tool that fails
// mid-turn must each land on a consistent end state without an outside harness.
//
// The eviction case is the branch the card names explicitly: the tool returned
// and the process died BEFORE `(run_id, step_index)` was written. The retry must
// replay the steps that already have a result and re-run only the one that does
// not — proved by a tool-call counter the journal keeps, not by inspection.
//
// test-type: integration (host + state machine + journal + run store; only the
// clock and the database are doubled).

const CRASH_STEP = 1;

async function statusOf(world: S4TurnHost, runId: string): Promise<RunStatusPayload> {
  return (await (await world.host.status.report(runId)).json()) as RunStatusPayload;
}

/** Opens a crash-injected turn and lets the alarm die on it, as the runtime would. */
async function runUntilCrash(world: S4TurnHost): Promise<string> {
  const opened = await world.host.intake.open(
    longTurnRequest({ crashBeforePersistStep: CRASH_STEP }),
    SESSION_ID,
  );
  await opened.body?.cancel();
  await assert.rejects(world.host.loop.runPending(), InjectedCrash);
  return runIdOfResponse(opened);
}

void test("a second turn on a busy session loses to the one-running-run index", async () => {
  const world = makeS4TurnHost();
  const first = await world.host.intake.open(longTurnRequest(), SESSION_ID);
  const second = await world.host.intake.open(longTurnRequest(), SESSION_ID);
  assert.equal(first.status, 200);
  assert.equal(second.status, 409);
  assert.deepEqual(await second.json(), { error: "session already has a running turn" });
});

void test("the session accepts the next turn once the running one is settled", async () => {
  const world = makeS4TurnHost();
  const first = await world.host.intake.open(longTurnRequest(), SESSION_ID);
  await first.body?.cancel();
  await world.host.loop.runPending();
  const second = await world.host.intake.open(longTurnRequest(), SESSION_ID);
  assert.equal(second.status, 200);
});

void test("a crash before the step row is written leaves the run running", async () => {
  const world = makeS4TurnHost();
  const status = await statusOf(world, await runUntilCrash(world));
  assert.equal(status.run.status, "running");
  assert.equal(status.run.finishedAt, null);
  assert.deepEqual(status.steps.map((step) => step.stepIndex), [0]);
  assert.equal(status.toolCalls, CRASH_STEP + 1, "the crashed step's tool really ran");
});

void test("the retry replays settled steps and re-runs only the unwritten one", async () => {
  const world = makeS4TurnHost();
  const runId = await runUntilCrash(world);
  await world.host.loop.runPending();
  const status = await statusOf(world, runId);
  assert.equal(status.run.status, "succeeded");
  assert.deepEqual(status.steps.map((step) => step.stepIndex), [0, 1, 2]);
  assert.equal(status.toolCalls, TOOL_CALLS + 1, "step 0 replayed, step 1 re-run once");
});

void test("the replayed step keeps the result the first attempt wrote", async () => {
  const world = makeS4TurnHost();
  const runId = await runUntilCrash(world);
  const before = await statusOf(world, runId);
  await world.host.loop.runPending();
  const after = await statusOf(world, runId);
  assert.deepEqual(after.steps[0], before.steps[0]);
});

void test("a restarted Durable Object replays from Neon, not from its memory", async () => {
  const world = makeS4TurnHost();
  const runId = await runUntilCrash(world);
  const restarted = makeS4TurnHost(world);
  await restarted.host.loop.runPending();
  const status = await statusOf(restarted, runId);
  assert.equal(status.run.status, "succeeded");
  assert.equal(status.toolCalls, TOOL_CALLS + 1, "a fresh incarnation still replays step 0");
});

void test("a tool failure mid-turn ends the run failed with a refunded reservation", async () => {
  const world = makeS4TurnHost();
  const opened = await world.host.intake.open(longTurnRequest({ failAtStep: 1 }), SESSION_ID);
  await opened.body?.cancel();
  await world.host.loop.runPending();
  const status = await statusOf(world, runIdOfResponse(opened));
  assert.equal(status.run.status, "failed");
  assert.equal(status.run.failureReason, "tool_failed");
  assert.notEqual(status.run.quotaRefundedAt, null);
  assert.deepEqual(status.steps.map((step) => step.stepIndex), [0]);
});

void test("the quota refund marker is written exactly once", async () => {
  const world = makeS4TurnHost();
  const opened = await world.host.intake.open(longTurnRequest({ failAtStep: 0 }), SESSION_ID);
  await opened.body?.cancel();
  await world.host.loop.runPending();
  const again = await world.store.failTurn(runIdOfResponse(opened), "tool_failed", new Date(0));
  assert.deepEqual(again, { settled: false, refunded: false });
});
