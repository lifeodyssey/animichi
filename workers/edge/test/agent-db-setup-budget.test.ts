/**
 * The agent-db arm's setup budget (#1292 review): the port bind, the two
 * connection waits and the `before` hook that awaits all of them draw on ONE
 * deadline, so the phases can no longer sum past the hook that holds them.
 *
 * Three independent timeouts were the bug — 240s for the bind plus 60s per wait
 * is 360s inside a 300s hook, before the Atlas chain runs at all — and the
 * arithmetic that fixes it is the part no Docker is needed to prove.
 *
 * test-type: unit (fake clock, no container).
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  SETUP_DEADLINE_MS,
  SETUP_HOOK_TIMEOUT_MS,
  SetupBudget,
} from "../agent-db-test/postgres-arm.ts";

/** A clock the test moves by hand; the budget reads it on every question. */
function makeElapsingClock() {
  let millis = 1_000_000;
  return {
    advance: (ms: number) => {
      millis += ms;
    },
    now: () => millis,
  };
}

void test("a fresh budget offers the whole deadline to the port bind", () => {
  const clock = makeElapsingClock();
  const budget = new SetupBudget(clock.now);
  assert.equal(budget.remainingMs(), SETUP_DEADLINE_MS);
});

void test("a bind that took 200s leaves the connection waits 40s of the deadline", () => {
  const clock = makeElapsingClock();
  const budget = new SetupBudget(clock.now);
  clock.advance(200_000);
  assert.equal(budget.remainingMs(), 40_000);
  assert.equal(budget.connectionAttempts(), 40);
});

void test("a spent deadline leaves no connection attempt to make", () => {
  const clock = makeElapsingClock();
  const budget = new SetupBudget(clock.now);
  clock.advance(SETUP_DEADLINE_MS + 30_000);
  assert.equal(budget.remainingMs(), 0);
  assert.equal(budget.connectionAttempts(), 0);
});

void test("a connection wait keeps its own ceiling while the deadline is plentiful", () => {
  const clock = makeElapsingClock();
  const budget = new SetupBudget(clock.now);
  assert.equal(budget.connectionAttempts(), 60);
});

void test("the hook timeout clears the deadline it has to hold", () => {
  assert.ok(SETUP_HOOK_TIMEOUT_MS > SETUP_DEADLINE_MS);
});
