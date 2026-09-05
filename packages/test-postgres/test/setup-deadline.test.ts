/**
 * The setup deadline's arithmetic (#1318, moved here by #1326).
 *
 * The port bind, the two connection waits and the `before` hook that awaits all
 * of them draw on ONE deadline, so the phases can no longer sum past the hook
 * that holds them. Three independent timeouts were the bug — 240 s for the bind
 * plus 60 s per wait is 360 s inside a 300 s hook, before the Atlas chain runs
 * at all — and the arithmetic that fixes it is the part no Docker is needed to
 * prove.
 *
 * These are the cases #1318 wrote as the edge suite's own
 * `agent-db-setup-budget.test.ts`, on the agent-db budget they were measured
 * against. That file is deleted, not merely moved past: the class it covered
 * now lives here, so its test does too.
 *
 * test-type: unit (fake clock, no container).
 */
import assert from "node:assert/strict";
import test from "node:test";
import { AGENT_DB_SETUP_BUDGET, hookTimeoutMs } from "../src/setup-budget.ts";
import { SetupDeadline } from "../src/setup-deadline.ts";

const BUDGET = AGENT_DB_SETUP_BUDGET;

/** A clock the test moves by hand; the deadline reads it on every question. */
function makeElapsingClock() {
  let millis = 1_000_000;
  return {
    advance: (ms: number) => {
      millis += ms;
    },
    now: () => millis,
  };
}

void test("a fresh deadline offers the whole budget to the port bind", () => {
  const clock = makeElapsingClock();
  assert.equal(new SetupDeadline(BUDGET, clock.now).remainingMs(), BUDGET.deadlineMs);
});

void test("a bind that took 200s leaves the connection waits 40s of the deadline", () => {
  const clock = makeElapsingClock();
  const deadline = new SetupDeadline(BUDGET, clock.now);
  clock.advance(200_000);
  assert.equal(deadline.remainingMs(), 40_000);
  assert.equal(deadline.connectionAttempts(), 40);
});

void test("a spent deadline leaves no connection attempt to make", () => {
  const clock = makeElapsingClock();
  const deadline = new SetupDeadline(BUDGET, clock.now);
  clock.advance(BUDGET.deadlineMs + 30_000);
  assert.equal(deadline.remainingMs(), 0);
  assert.equal(deadline.connectionAttempts(), 0);
});

void test("a connection wait keeps its own ceiling while the deadline is plentiful", () => {
  const clock = makeElapsingClock();
  const deadline = new SetupDeadline(BUDGET, clock.now);
  assert.equal(deadline.connectionAttempts(), 60);
});

void test("the hook timeout clears the deadline it has to hold", () => {
  assert.ok(hookTimeoutMs(BUDGET) > BUDGET.deadlineMs);
});

/** The startup wait takes limits, not a number, so the remaining allowance has
 * to arrive in that shape or the wait would silently keep its full ceiling. */
void test("the remaining allowance reaches the startup wait as its own limits", () => {
  const clock = makeElapsingClock();
  const deadline = new SetupDeadline(BUDGET, clock.now);
  clock.advance(210_000);
  assert.deepEqual(deadline.firstSessionLimits(), { attemptCeiling: 30, pauseMs: 1_000 });
});

/** The spike arm's smaller ceiling is a ceiling, not a deadline: a plentiful
 * clock still buys it only 30 attempts. */
void test("a budget's own ceiling caps a plentiful deadline", () => {
  const clock = makeElapsingClock();
  const spike = { ...BUDGET, firstSession: { attemptCeiling: 30, pauseMs: 1_000 } };
  assert.equal(new SetupDeadline(spike, clock.now).connectionAttempts(), 30);
});
