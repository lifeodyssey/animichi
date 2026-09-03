/**
 * W1-3 (#1252): the alarm-hosted turn, driven over the REAL pi agent loop.
 *
 * The provider is scripted but truthful (`pi-provider-double.ts`), the store
 * keeps the DDL's own invariants (`in-memory-turn-store.ts`), and the tool
 * counts its executions — so "the step was replayed" is measured as "the tool
 * did not run again", not asserted about a flag.
 *
 * test-type: unit (fake clock; no network, no database).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { DurableTurn } from "../src/agent/session/durable-turn.ts";
import type { PersistedStep, TranscriptRow } from "../src/agent/session/turn-store.ts";
import { InMemoryTurnStore } from "./doubles/in-memory-turn-store.ts";
import {
  CountingSpotLookup,
  makeScriptedModels,
  makeUserTranscript,
} from "./doubles/make-turn-parts.ts";
import { makeToolCallingStreamFn } from "./doubles/pi-provider-double.ts";

const RUN_ID = "run-1";
const OWNER = "do-incarnation-1";
const NOW = 1_000;
const DEADLINE = NOW + 100_000;
const PRICES = { inputUsdPerMtok: 1, outputUsdPerMtok: 2 };

interface Harness {
  readonly store: InMemoryTurnStore;
  readonly toolbox: CountingSpotLookup;
  readonly turn: DurableTurn;
}

function makeHarness(seed: Partial<{ transcript: TranscriptRow[]; steps: PersistedStep[] }> = {}): Harness {
  const now = () => NOW;
  const store = new InMemoryTurnStore(
    {
      runId: RUN_ID,
      sessionId: "session-1",
      deadlineAt: DEADLINE,
      transcript: seed.transcript ?? makeUserTranscript(),
      steps: seed.steps ?? [],
    },
    now,
  );
  const toolbox = new CountingSpotLookup();
  const parts = {
    store,
    models: makeScriptedModels(),
    toolbox,
    systemPrompt: "test",
    prices: PRICES,
    emit: () => Promise.resolve(),
    owner: OWNER,
    now,
  };
  return { store, toolbox, turn: new DurableTurn(parts) };
}

void test("a fresh turn calls its tool once, settles succeeded and banks its usage", async () => {
  const { store, toolbox, turn } = makeHarness();
  assert.deepEqual(await turn.run(RUN_ID), { phase: "succeeded" });
  assert.equal(toolbox.calls, 1);
  assert.equal(store.succeeded.length, 1);
  assert.equal(store.succeeded[0]?.usage.requests, 2);
  assert.equal(store.failed.length, 0);
});

void test("the step and the assistant message that issued it are persisted together", async () => {
  const { store, turn } = makeHarness();
  await turn.run(RUN_ID);
  assert.deepEqual(store.steps.map((step) => step.stepIndex), [0]);
  const envelope = store.written.at(0)?.toolCallMessage ?? null;
  assert.ok(envelope !== null, "the assistant tool-call message rode the step");
  assert.equal(envelope.run_id, RUN_ID);
  assert.equal(envelope.step_index, 0);
});

void test("a step that already has a result is replayed instead of executed", async () => {
  const settled = { content: [{ type: "text" as const, text: "cached" }], details: null };
  const { store, toolbox, turn } = makeHarness({
    steps: [{ stepIndex: 0, toolName: "lookup_spot", input: { title: "Hyouka" }, result: settled }],
  });
  assert.deepEqual(await turn.run(RUN_ID), { phase: "succeeded" });
  assert.equal(toolbox.calls, 0);
  assert.equal(store.steps.length, 1);
});

void test("the settlement leaves the lease released", async () => {
  const { store, turn } = makeHarness();
  await turn.run(RUN_ID);
  assert.deepEqual(store.lease, { owner: null, expiresAt: null });
});

void test("a turn whose run is no longer running settles nothing", async () => {
  const { store, toolbox, turn } = makeHarness();
  await store.settleFailed(RUN_ID, "cancelled", new Date(NOW));
  assert.deepEqual(await turn.run(RUN_ID), { phase: "already_settled" });
  assert.equal(toolbox.calls, 0);
  assert.equal(store.succeeded.length, 0);
});

void test("a provider that fails settles the turn failed exactly once", async () => {
  const { store, turn } = makeHarness();
  const failing = new DurableTurn({
    store,
    models: makeScriptedModels(() => {
      throw new Error("gateway said no");
    }),
    toolbox: new CountingSpotLookup(),
    systemPrompt: "test",
    prices: PRICES,
    emit: () => Promise.resolve(),
    owner: OWNER,
    now: () => NOW,
  });
  const state = await failing.run(RUN_ID);
  assert.equal(state.phase, "failed");
  assert.deepEqual(store.failed, ["provider_failed"]);
  assert.equal(store.succeeded.length, 0);
  void turn;
});

void test("a turn past its deadline settles deadline_exceeded, not an answer", async () => {
  const store = new InMemoryTurnStore(
    { runId: RUN_ID, sessionId: "s", deadlineAt: NOW, transcript: makeUserTranscript(), steps: [] },
    () => NOW,
  );
  const expired = new DurableTurn({
    store,
    models: makeScriptedModels(makeToolCallingStreamFn()),
    toolbox: new CountingSpotLookup(),
    systemPrompt: "test",
    prices: PRICES,
    emit: () => Promise.resolve(),
    owner: OWNER,
    now: () => NOW,
  });
  assert.deepEqual(await expired.run(RUN_ID), { phase: "failed", reason: "deadline_exceeded" });
  assert.deepEqual(store.failed, ["deadline_exceeded"]);
});

/** The Appendix C branch at unit scale: the tool returned, the step row did not
 * land, and the turn must be left `running` for the alarm's retry rather than
 * settled by a store that just refused a write. */
void test("a store that refuses a step write leaves the run unsettled", async () => {
  const { store, toolbox, turn } = makeHarness();
  store.stepWritesFail = true;
  await assert.rejects(() => turn.run(RUN_ID), { name: "TurnStoreUnavailable" });
  assert.equal(toolbox.calls, 1);
  assert.equal(store.succeeded.length, 0);
  assert.deepEqual(store.failed, []);
  assert.deepEqual(store.steps, []);
});
