/**
 * W1-3 (#1252): every transition of the alarm-hosted turn's state machine.
 *
 * The clock is a counter, not `Date.now`: the deadline branch is a comparison
 * against it, so a real clock would make the case a race.
 *
 * test-type: unit.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  LEASE_SLICE_MS,
  ProviderFailure,
  RunMachine,
  TurnAborted,
  failureReasonOf,
} from "../src/agent/session/run-machine.ts";

const DEADLINE = 100_000;

function makeMachine(nowMs = 0): { machine: RunMachine; tick: (to: number) => void } {
  let clock = nowMs;
  const machine = new RunMachine(DEADLINE, () => clock);
  return { machine, tick: (to) => { clock = to; } };
}

void test("a turn starts unclaimed and nothing has been decided", () => {
  assert.deepEqual(makeMachine().machine.state, { phase: "unclaimed" });
});

void test("winning the compare-and-set puts the turn in running", () => {
  const { machine } = makeMachine();
  assert.deepEqual(machine.claim(true), { phase: "running" });
});

void test("losing it declines the turn to whoever holds the lease", () => {
  const { machine } = makeMachine();
  assert.deepEqual(machine.claim(false), { phase: "declined" });
});

void test("a lease slice is one slice long while the deadline is far away", () => {
  const { machine } = makeMachine(1_000);
  assert.equal(machine.leaseUntil().getTime(), 1_000 + LEASE_SLICE_MS);
});

void test("a lease slice is clamped at the run's own deadline", () => {
  const { machine } = makeMachine(DEADLINE - 1);
  assert.equal(machine.leaseUntil().getTime(), DEADLINE);
});

void test("a step inside the budget keeps the turn running", () => {
  const { machine, tick } = makeMachine();
  machine.claim(true);
  tick(DEADLINE - 1);
  assert.deepEqual(machine.beginStep(), { phase: "running" });
});

void test("a step past the deadline fails the turn with deadline_exceeded", () => {
  const { machine, tick } = makeMachine();
  machine.claim(true);
  tick(DEADLINE);
  assert.deepEqual(machine.beginStep(), { phase: "failed", reason: "deadline_exceeded" });
});

void test("a renewal that held keeps the turn running", () => {
  const { machine } = makeMachine();
  machine.claim(true);
  assert.deepEqual(machine.renewed(true), { phase: "running" });
});

void test("a renewal that lost abandons the turn to its new owner", () => {
  const { machine } = makeMachine();
  machine.claim(true);
  assert.deepEqual(machine.renewed(false), { phase: "abandoned" });
});

void test("a turn that answered succeeds", () => {
  const { machine } = makeMachine();
  machine.claim(true);
  assert.deepEqual(machine.succeed(), { phase: "succeeded" });
});

void test("a provider failure fails the turn with provider_failed", () => {
  const { machine } = makeMachine();
  machine.claim(true);
  assert.deepEqual(machine.fail(new ProviderFailure("502")), {
    phase: "failed",
    reason: "provider_failed",
  });
});

void test("an abort fails the turn with cancelled", () => {
  assert.equal(failureReasonOf(new TurnAborted("stopped")), "cancelled");
});

void test("anything unclassified fails the turn with internal_error", () => {
  assert.equal(failureReasonOf(new Error("boom")), "internal_error");
  assert.equal(failureReasonOf("boom"), "internal_error");
});

void test("the machine reports the phase it last moved to", () => {
  const { machine } = makeMachine();
  machine.claim(true);
  machine.fail(new ProviderFailure("502"));
  assert.deepEqual(machine.state, { phase: "failed", reason: "provider_failed" });
});
