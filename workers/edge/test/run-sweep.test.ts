/**
 * W1-2 (#1251): the sweep's re-arm loop. WHICH rows it is handed is the
 * database's decision (`idx_runs_sweep`) and is proven against real PostgreSQL
 * in `db-test/turn-intake.db.test.ts`; what this file pins is that every row
 * it is handed gets exactly one arm, addressed to that row's own session, and
 * that the sweep reports what it did.
 *
 * test-type: unit (in-memory ports, injected clock, no database).
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_SWEEP_INTERVAL_SECONDS,
  sweepIntervalMs,
  sweepRuns,
  type RunLeases,
  type SweepableRun,
} from "../src/agent/sweeper/run-sweep.ts";
import type { SessionWakeup } from "../src/agent/session/session-wakeup.ts";

const NOW = Date.parse("2026-09-02T23:30:00.000Z");

/** Leases that answer `stranded` and remember the clock they were asked with. */
function makeLeases(stranded: SweepableRun[]): RunLeases & { asked: number[] } {
  const asked: number[] = [];
  return {
    asked,
    withoutLiveLease(nowMs) {
      asked.push(nowMs);
      return Promise.resolve(stranded);
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

/** A wake-up whose FIRST arm rejects and whose later ones are recorded. */
function makeWakeupFailingOnce(): SessionWakeup & { armed: string[][] } {
  const recording = makeRecordingWakeup();
  let attempts = 0;
  return {
    armed: recording.armed,
    arm(sessionId, runId) {
      attempts += 1;
      return attempts === 1
        ? Promise.reject(new Error("session unreachable"))
        : recording.arm(sessionId, runId);
    },
  };
}

void test("every stranded run is armed once, on its own session", async () => {
  const wakeup = makeRecordingWakeup();
  const stranded = [
    { runId: "run-1", sessionId: "session-a" },
    { runId: "run-2", sessionId: "session-b" },
  ];
  const swept = await sweepRuns(makeLeases(stranded), wakeup, NOW);
  assert.equal(swept, 2);
  assert.deepEqual(wakeup.armed, [["session-a", "run-1"], ["session-b", "run-2"]]);
});

void test("one unreachable session does not cancel the rest of the batch", async () => {
  const wakeup = makeWakeupFailingOnce();
  const stranded = [
    { runId: "run-1", sessionId: "session-a" },
    { runId: "run-2", sessionId: "session-b" },
    { runId: "run-3", sessionId: "session-c" },
  ];
  await assert.rejects(sweepRuns(makeLeases(stranded), wakeup, NOW), /session unreachable/);
  assert.deepEqual(wakeup.armed, [["session-b", "run-2"], ["session-c", "run-3"]]);
});

void test("a sweep that finds nothing arms nothing", async () => {
  const wakeup = makeRecordingWakeup();
  assert.equal(await sweepRuns(makeLeases([]), wakeup, NOW), 0);
  assert.deepEqual(wakeup.armed, []);
});

void test("the sweep reads the lease horizon from its own clock, not the database's", async () => {
  const leases = makeLeases([]);
  await sweepRuns(leases, makeRecordingWakeup(), NOW);
  assert.deepEqual(leases.asked, [NOW]);
});

void test("the sweep cadence comes from the deployment, in whole milliseconds", () => {
  assert.equal(sweepIntervalMs("30"), 30_000);
  assert.equal(sweepIntervalMs("60"), DEFAULT_SWEEP_INTERVAL_SECONDS * 1_000);
});

void test("a missing or nonsense cadence falls back to the default, never to zero", () => {
  const configured = [undefined, "", "0", "-5", "soon", 30];
  const intervals = configured.map((value) => sweepIntervalMs(value));
  assert.deepEqual(intervals, new Array(configured.length).fill(DEFAULT_SWEEP_INTERVAL_SECONDS * 1_000));
});
