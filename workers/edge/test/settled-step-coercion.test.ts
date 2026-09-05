/**
 * E-2 (#1381): the divergence, driven through the real pi loop.
 *
 * The card's whole premise is that a tool's arguments have two authors, and
 * that they can disagree. Everything else in this suite states that premise;
 * this test makes it happen. A model sends `bangumi_id` as text, the tool's
 * schema declares a number, and pi settles the one into the other
 * (`validateToolArguments`: a structured clone, optional nulls dropped,
 * `Value.Convert` against the JSON Schema) before `execute` is called.
 *
 * Three things are then read off one real turn: what the tool RAN with, what
 * `run_steps.input` recorded, and what the SD-9 frame published. The first two
 * agree and the third does not — which is why the retrieval publishes the
 * settled params instead of letting the metric read the stream twice.
 *
 * test-type: unit (scripted provider, in-memory store; fake clock, no network).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { DurableTurn } from "../src/agent/session/durable-turn.ts";
import type { TurnFrame } from "../src/agent/session/turn-frames.ts";
import { InMemoryTurnStore } from "./doubles/in-memory-turn-store.ts";
import {
  CoercingBangumiLookup,
  makeScriptedTurnModel,
  makeSessionTurnParts,
  makeUserTranscript,
} from "./doubles/make-turn-parts.ts";
import { makeSequencedToolCallsStreamFn } from "./doubles/pi-provider-double.ts";

const RUN_ID = "run-1";
const NOW = 1_000;

/** What the model asked with: the id as text, which its schema does not admit. */
const RAW_ARGUMENTS = { bangumi_id: "12345" };

/** What the tool ran with, once pi had settled those arguments. */
const SETTLED_PARAMS = { bangumi_id: 12345 };

interface Turn {
  readonly store: InMemoryTurnStore;
  readonly toolbox: CoercingBangumiLookup;
  readonly frames: TurnFrame[];
  readonly turn: DurableTurn;
}

function makeCoercedTurn(): Turn {
  const now = () => NOW;
  const store = new InMemoryTurnStore(
    { runId: RUN_ID, sessionId: "session-1", deadlineAt: NOW + 100_000, transcript: makeUserTranscript(), steps: [] },
    now,
  );
  const toolbox = new CoercingBangumiLookup();
  const frames: TurnFrame[] = [];
  const model = makeScriptedTurnModel(
    makeSequencedToolCallsStreamFn([{ name: "search_bangumi", arguments: RAW_ARGUMENTS }]),
  );
  const parts = {
    store,
    model,
    toolbox,
    ...makeSessionTurnParts(),
    systemPrompt: "test",
    prices: { inputUsdPerMtok: 0, outputUsdPerMtok: 0 },
    emit: (pushed: readonly TurnFrame[]) => {
      frames.push(...pushed);
      return Promise.resolve();
    },
    owner: "do-incarnation-1",
    now,
  };
  return { store, toolbox, frames, turn: new DurableTurn(parts) };
}

/** The `input` the stream published for the call, if it published one. */
function publishedInput(frames: readonly TurnFrame[]): unknown {
  return frames.find((frame) => frame.type === "tool-input-available")?.input;
}

void test("the tool runs with the arguments pi settled, not the ones the model sent", async () => {
  const { toolbox, turn } = makeCoercedTurn();
  assert.deepEqual(await turn.run(RUN_ID), { phase: "succeeded" });
  assert.deepEqual(toolbox.executedWith, [SETTLED_PARAMS]);
});

void test("run_steps records what the tool executed with", async () => {
  const { store, turn } = makeCoercedTurn();
  await turn.run(RUN_ID);
  assert.deepEqual(store.steps.map((step) => step.input), [SETTLED_PARAMS]);
});

void test("the stream publishes what the model asked with, which is not that", async () => {
  const { frames, turn } = makeCoercedTurn();
  await turn.run(RUN_ID);
  assert.deepEqual(publishedInput(frames), RAW_ARGUMENTS);
  assert.notDeepEqual(publishedInput(frames), SETTLED_PARAMS);
});
