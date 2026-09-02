import test from "node:test";
import assert from "node:assert/strict";
import { Agent } from "@earendil-works/pi-agent-core";
import { PiTurnRun, type TurnFrame } from "../spike/pi/src/pi-turn-run.ts";
import { createSpikeModels, modelFor } from "../spike/pi/src/spike-models.ts";
import { createSpotLookupTool } from "../spike/pi/src/spot-lookup-tool.ts";
import type { AbortPoint } from "../spike/pi/src/turn-command.ts";
import type { TurnOutcome } from "../spike/pi/src/turn-outcome.ts";
import { DOUBLE_ANSWER, makeToolCallingStreamFn } from "./doubles/pi-provider-double.ts";

// W0-S1 (#1244) integration criterion: aborting at each of the three break
// points must leave no dangling state. The turn below runs the real pi agent
// loop and the real spike tool; only the provider stream is a double, and that
// double honours its abort signal the way a shipped adapter does.
//
// test-type: integration (real agent loop + real tool; no network, mocked clock).

const TOOL_HOLD_MS = 40;

function makeSpikeAgent(): Agent {
  const models = createSpikeModels({ MIMO_API_KEY: "not-a-real-key" });
  const model = modelFor(models, "mimo");
  assert.ok(model, "the mimo model must register from a key alone");
  return new Agent({
    initialState: {
      systemPrompt: "spike",
      model,
      tools: [createSpotLookupTool(TOOL_HOLD_MS)],
    },
    streamFn: makeToolCallingStreamFn(),
  });
}

function makeStepClock(): () => number {
  let reading = 0;
  return () => (reading += 5);
}

interface SpikeRunResult {
  outcome: TurnOutcome;
  frames: TurnFrame[];
}

async function runSpikeTurn(abortPoint: AbortPoint | null): Promise<SpikeRunResult> {
  const frames: TurnFrame[] = [];
  const command = { provider: "mimo" as const, prompt: "where is Hyouka", abortPoint };
  const run = new PiTurnRun(
    makeSpikeAgent(),
    command,
    (frame) => {
      frames.push(frame);
    },
    makeStepClock(),
  );
  return { outcome: await run.execute("run-1"), frames };
}

void test("an unaborted spike turn calls the tool and answers", async () => {
  const { outcome, frames } = await runSpikeTurn(null);
  assert.equal(outcome.abortFired, false);
  assert.equal(outcome.text, DOUBLE_ANSWER);
  assert.ok(outcome.events.includes("tool_execution_end"));
  assert.equal(outcome.events.at(-1), "agent_end");
  assert.equal(frames.length, outcome.events.length);
});

void test("an unaborted spike turn leaves no dangling state", async () => {
  const { outcome } = await runSpikeTurn(null);
  assert.equal(outcome.clean, true);
  assert.deepEqual(outcome.dangling.pendingToolCalls, []);
  assert.equal(outcome.dangling.isStreaming, false);
});

void test("aborting mid provider stream stops before the tool runs", async () => {
  const { outcome } = await runSpikeTurn("provider_stream");
  assert.equal(outcome.abortFired, true);
  assert.equal(outcome.events.includes("tool_execution_start"), false);
  assert.equal(outcome.text, "", "the answer must not arrive after a mid-stream abort");
  assert.equal(outcome.clean, true);
});

void test("aborting mid tool call cancels the tool rather than waiting it out", async () => {
  const { outcome, frames } = await runSpikeTurn("tool_call");
  const ended = frames.find((frame) => frame.event === "tool_execution_end");
  assert.equal(ended?.data.isError, true, "the tool must end aborted, not with its result");
  assert.equal(outcome.text, "");
  assert.deepEqual(outcome.dangling.pendingToolCalls, []);
  assert.equal(outcome.clean, true);
});

void test("aborting before the final frame keeps the completed answer", async () => {
  const { outcome } = await runSpikeTurn("final_frame");
  assert.equal(outcome.abortFired, true);
  assert.equal(outcome.text, DOUBLE_ANSWER, "content already produced must survive the abort");
  assert.equal(outcome.messageCount, 4);
  assert.equal(outcome.clean, true);
});

void test("the mocked clock is the only source of the reported duration", async () => {
  const { outcome } = await runSpikeTurn(null);
  assert.equal(outcome.durationMs, 5);
});
