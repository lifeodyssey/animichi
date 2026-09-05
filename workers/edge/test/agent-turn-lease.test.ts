/**
 * W1-3 (#1252): the single-writer lease, which is what makes the at-least-once
 * wake-up safe (spec §三: "扫描幂等（重复叫醒无副作用，由 DO 侧租约保证）").
 *
 * Two properties, and they are opposites: a run another live incarnation holds
 * must NOT be run a second time, and a run whose lease expired MUST be
 * reclaimable — otherwise the sweeper's backstop could never finish anything.
 *
 * The clock is a variable, so "the lease expired" is a fact the case sets
 * rather than a wait it hopes for.
 *
 * test-type: unit.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { DurableTurn } from "../src/agent/session/durable-turn.ts";
import { InMemoryTurnStore, type SeededRun } from "./doubles/in-memory-turn-store.ts";
import { CountingSpotLookup, makeScriptedTurnModel, makeSessionTurnParts, makeUserTranscript } from "./doubles/make-turn-parts.ts";

const RUN_ID = "run-1";
const OWNER = "do-incarnation-2";
const START = 1_000;

interface Clock {
  now: () => number;
  set: (to: number) => void;
}

function makeClock(): Clock {
  let value = START;
  return { now: () => value, set: (to) => { value = to; } };
}

function seed(overrides: Partial<SeededRun> = {}): SeededRun {
  return {
    runId: RUN_ID,
    sessionId: "session-1",
    deadlineAt: START + 100_000,
    transcript: makeUserTranscript(),
    steps: [],
    ...overrides,
  };
}

function makeTurn(store: InMemoryTurnStore, clock: Clock, toolbox: CountingSpotLookup): DurableTurn {
  return new DurableTurn({
    store,
    model: makeScriptedTurnModel(),
    ...makeSessionTurnParts(),
    toolbox,
    systemPrompt: "test",
    prices: { inputUsdPerMtok: 0, outputUsdPerMtok: 0 },
    emit: () => Promise.resolve(),
    owner: OWNER,
    now: clock.now,
  });
}

void test("a run another live incarnation holds is declined, and nothing runs", async () => {
  const clock = makeClock();
  const store = new InMemoryTurnStore(
    seed({ leaseOwner: "do-incarnation-1", leaseExpiresAt: START + 30_000 }),
    clock.now,
  );
  const toolbox = new CountingSpotLookup();
  assert.deepEqual(await makeTurn(store, clock, toolbox).run(RUN_ID), { phase: "declined" });
  assert.equal(toolbox.calls, 0);
  assert.equal(store.succeeded.length, 0);
  assert.equal(store.lease.owner, "do-incarnation-1");
});

void test("a run whose lease expired is reclaimed and driven to succeeded", async () => {
  const clock = makeClock();
  const store = new InMemoryTurnStore(
    seed({ leaseOwner: "do-incarnation-1", leaseExpiresAt: START - 1 }),
    clock.now,
  );
  const toolbox = new CountingSpotLookup();
  assert.deepEqual(await makeTurn(store, clock, toolbox).run(RUN_ID), { phase: "succeeded" });
  assert.equal(toolbox.calls, 1);
  assert.equal(store.succeeded.length, 1);
});

void test("a lease lost mid-turn abandons the turn instead of settling it", async () => {
  const clock = makeClock();
  const store = new InMemoryTurnStore(seed(), clock.now);
  const stolen = async (): Promise<void> => {
    clock.set(START + 60_000);
    await store.takeLease(RUN_ID, "do-incarnation-3", new Date(START + 90_000));
  };
  const toolbox = new CountingSpotLookup(stolen);
  assert.deepEqual(await makeTurn(store, clock, toolbox).run(RUN_ID), { phase: "abandoned" });
  assert.equal(store.succeeded.length, 0);
  assert.equal(store.failed.length, 0);
  assert.equal(store.lease.owner, "do-incarnation-3");
});

void test("a lease that only lapsed is re-taken by the step's own write", async () => {
  const clock = makeClock();
  const store = new InMemoryTurnStore(seed(), clock.now);
  const overran = (): Promise<void> => {
    clock.set(START + 60_000);
    return Promise.resolve();
  };
  const toolbox = new CountingSpotLookup(overran);
  assert.deepEqual(await makeTurn(store, clock, toolbox).run(RUN_ID), { phase: "succeeded" });
  assert.equal(store.steps.length, 1);
  assert.equal(store.lease.owner, null, "a settled run releases the lease it re-took");
});

void test("an abandoned turn wrote no step for the work it did", async () => {
  const clock = makeClock();
  const store = new InMemoryTurnStore(seed(), clock.now);
  const stolen = async (): Promise<void> => {
    clock.set(START + 60_000);
    await store.takeLease(RUN_ID, "do-incarnation-3", new Date(START + 90_000));
  };
  await makeTurn(store, clock, new CountingSpotLookup(stolen)).run(RUN_ID);
  assert.deepEqual(store.steps, []);
});
