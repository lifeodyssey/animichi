import test from "node:test";
import assert from "node:assert/strict";
import { DurableTurn } from "../src/agent/session/durable-turn.ts";
import { ERROR_TEXT, type TurnFrame } from "../src/agent/session/turn-frames.ts";
import type { TurnModel } from "../src/agent/session/turn-model.ts";
import { InMemoryTurnStore } from "./doubles/in-memory-turn-store.ts";
import {
  CountingSpotLookup,
  makeScriptedTurnModel,
  makeSessionTurnParts,
  makeUserTranscript,
} from "./doubles/make-turn-parts.ts";
import { makeToolCallingStreamFn } from "./doubles/pi-provider-double.ts";

// W2-3 (#1289) — the server-key fallback red line held on the DURABLE OBJECT
// side, not only at the request that opened the turn.
//
// A BYOK credential lives in one incarnation's heap and dies with it, while the
// run row survives. So a caller-keyed run can arrive at an alarm that does not
// have its key — after an eviction, or after `RunSweeper` re-armed it (the
// sweeper carries no credential at all; `byok-arm-hop.test.ts` pins that its
// arm request is credential-free). `runs.payer = 'byok'` is the only durable
// trace that such a turn was caller-keyed, and it is what this refusal reads.
//
// test-type: unit (fake clock; no network, no database).

const RUN_ID = "run-1";
const NOW = 1_000;
const PRICES = { inputUsdPerMtok: 1, outputUsdPerMtok: 2 };

/** The server-key model an incarnation with no credential would otherwise
 * reach for, with its provider calls counted. */
function makeCountedServerModel(): { model: TurnModel; calls: () => number } {
  let calls = 0;
  const scripted = makeToolCallingStreamFn();
  const counting: typeof scripted = (model, context, options) => {
    calls += 1;
    return scripted(model, context, options);
  };
  return { model: makeScriptedTurnModel(counting), calls: () => calls };
}

function makeStore(callerKeyed: boolean): InMemoryTurnStore {
  const seed = {
    runId: RUN_ID,
    sessionId: "session-1",
    deadlineAt: NOW + 100_000,
    transcript: makeUserTranscript(),
    steps: [],
    callerKeyed,
  };
  return new InMemoryTurnStore(seed, () => NOW);
}

function makeTurn(store: InMemoryTurnStore, model: TurnModel, pushed: TurnFrame[]) {
  const toolbox = new CountingSpotLookup();
  const turn = new DurableTurn({
    store,
    model,
    toolbox,
    ...makeSessionTurnParts(),
    systemPrompt: "test",
    prices: PRICES,
    emit: (frames) => {
      pushed.push(...frames);
      return Promise.resolve();
    },
    owner: "do-2",
    now: () => NOW,
  });
  return { turn, toolbox };
}

// ── the refusal ────────────────────────────────────────────────────────────

void test("an evicted incarnation settles a caller-keyed run failed instead of spending the server key", async () => {
  const store = makeStore(true);
  const server = makeCountedServerModel();
  const { turn, toolbox } = makeTurn(store, server.model, []);
  const state = await turn.run(RUN_ID);
  assert.deepEqual(state, { phase: "failed", reason: "provider_failed" });
  assert.deepEqual(store.failed, ["provider_failed"], "the reservation is given back by that SQL");
  assert.equal(server.calls(), 0, "no provider may be contacted with the wrong key");
  assert.equal(toolbox.calls, 0);
  assert.equal(store.succeeded.length, 0);
});

void test("a sweeper re-arm of a stranded caller-keyed run closes the stream on the error frames", async () => {
  const pushed: TurnFrame[] = [];
  const store = makeStore(true);
  const { turn } = makeTurn(store, makeCountedServerModel().model, pushed);
  await turn.run(RUN_ID);
  assert.deepEqual(pushed.at(-1), { type: "finish", finishReason: "error" });
  assert.ok(
    pushed.some((frame) => frame.type === "error" && frame.errorText === ERROR_TEXT),
    "a connected client has to see the failure to know it may resend",
  );
});

// ── the two controls ───────────────────────────────────────────────────────

void test("a run the platform pays for still runs on the server key", async () => {
  const store = makeStore(false);
  const server = makeCountedServerModel();
  const { turn, toolbox } = makeTurn(store, server.model, []);
  assert.deepEqual(await turn.run(RUN_ID), { phase: "succeeded" });
  assert.equal(server.calls() > 0, true);
  assert.equal(toolbox.calls, 1);
});

void test("a caller-keyed run whose incarnation still holds the key runs normally", async () => {
  const store = makeStore(true);
  const server = makeCountedServerModel();
  const held: TurnModel = { ...server.model, callerKeyed: true };
  const { turn } = makeTurn(store, held, []);
  assert.deepEqual(await turn.run(RUN_ID), { phase: "succeeded" });
  assert.equal(server.calls() > 0, true);
});
