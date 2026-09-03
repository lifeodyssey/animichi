/**
 * W1-3 (#1252): the alarm → SSE handoff (spec §三).
 *
 * Best-effort by contract: the frames are a live view of a turn whose truth is
 * in Neon, so a subscriber that hung up is dropped and the turn is unaffected,
 * and a turn with no subscriber at all still runs to its ending.
 *
 * The frame shapes are read off the recorded captures the web suite replays
 * (`apps/agent/tests/fixtures/chat_stream/*.sse`), so this pins the wire, not a
 * shape invented here.
 *
 * test-type: unit (streams only; no clock, no network).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { DurableTurn } from "../src/agent/session/durable-turn.ts";
import { closingFrames, framesFor, openingFrames } from "../src/agent/session/turn-frames.ts";
import { TurnSubscribers } from "../src/agent/session/turn-subscribers.ts";
import { InMemoryTurnStore } from "./doubles/in-memory-turn-store.ts";
import { CountingSpotLookup, makeScriptedModels, makeUserTranscript } from "./doubles/make-turn-parts.ts";

const RUN_ID = "run-1";
const NOW = 1_000;

async function readAll(body: ReadableStream<Uint8Array>): Promise<string> {
  return await new Response(body).text();
}

function makeStore(): InMemoryTurnStore {
  return new InMemoryTurnStore(
    {
      runId: RUN_ID,
      sessionId: "session-1",
      deadlineAt: NOW + 100_000,
      transcript: makeUserTranscript(),
      steps: [],
    },
    () => NOW,
  );
}

function makeTurn(emit: TurnSubscribers): DurableTurn {
  return makeTurnOn(makeStore(), emit);
}

function makeTurnOn(store: InMemoryTurnStore, emit: TurnSubscribers): DurableTurn {
  const now = () => NOW;
  return new DurableTurn({
    store,
    models: makeScriptedModels(),
    toolbox: new CountingSpotLookup(),
    systemPrompt: "test",
    prices: { inputUsdPerMtok: 0, outputUsdPerMtok: 0 },
    emit: emit.sinkFor(RUN_ID),
    owner: "do-1",
    now,
  });
}

void test("a stream opens with the SD-9 message and step start frames", () => {
  assert.deepEqual(openingFrames(), [{ type: "start" }, { type: "start-step" }]);
});

void test("a tool call becomes the two tool-input frames the protocol names", () => {
  const frames = framesFor({
    type: "tool_execution_start",
    toolCallId: "call-1",
    toolName: "lookup_spot",
    args: { title: "Hyouka" },
  });
  assert.deepEqual(frames, [
    { type: "tool-input-start", toolCallId: "call-1", toolName: "lookup_spot" },
    { type: "tool-input-available", toolCallId: "call-1", toolName: "lookup_spot", input: { title: "Hyouka" } },
  ]);
});

void test("a tool result becomes tool-output-available carrying its details", () => {
  const frames = framesFor({
    type: "tool_execution_end",
    toolCallId: "call-1",
    toolName: "lookup_spot",
    result: { content: [], details: { title: "Hyouka" } },
    isError: false,
  });
  assert.deepEqual(frames, [
    { type: "tool-output-available", toolCallId: "call-1", output: { title: "Hyouka" } },
  ]);
});

void test("a failed turn closes on error, not on stop", () => {
  const closed = closingFrames({ phase: "failed", reason: "provider_failed" });
  assert.deepEqual(closed.map((frame) => frame.type), ["error", "finish-step", "finish"]);
  assert.deepEqual(closingFrames({ phase: "succeeded" }).at(-1), {
    type: "finish",
    finishReason: "stop",
  });
});

/** The client is read CONCURRENTLY on purpose: the channel awaits every write,
 * so the frames arrive under the protocol's own backpressure rather than into a
 * buffer a test drained afterwards. */
void test("a registered subscriber reads the turn's frames and its terminator", async () => {
  const subscribers = new TurnSubscribers();
  const reading = readAll(subscribers.register(RUN_ID).body);
  await makeTurn(subscribers).run(RUN_ID);
  await subscribers.finish(RUN_ID);
  const streamed = await reading;
  assert.match(streamed, /^data: \{"type":"start"\}\n\n/);
  assert.match(streamed, /data: \{"type":"tool-input-start"/);
  assert.match(streamed, /data: \{"type":"finish","finishReason":"stop"\}/);
  assert.match(streamed, /data: \[DONE\]\n\n$/);
});

void test("a subscriber that hung up is dropped and the turn still succeeds", async () => {
  const subscribers = new TurnSubscribers();
  const channel = subscribers.register(RUN_ID);
  await channel.body.cancel();
  assert.deepEqual(await makeTurn(subscribers).run(RUN_ID), { phase: "succeeded" });
  assert.equal(channel.clientGone, true);
});

void test("a turn nobody is watching still runs to its ending", async () => {
  const subscribers = new TurnSubscribers();
  assert.deepEqual(await makeTurn(subscribers).run(RUN_ID), { phase: "succeeded" });
});

/** A declined turn opened no stream, so a subscriber on it sees only the
 * terminator: this incarnation never hosted the turn, and inventing `start` /
 * `finish` frames for one it does not own would contradict the owner's. */
void test("a declined turn writes no frames to a subscriber watching it", async () => {
  const subscribers = new TurnSubscribers();
  const reading = readAll(subscribers.register(RUN_ID).body);
  const store = makeStore();
  await store.settleFailed(RUN_ID, "cancelled", new Date(NOW));
  assert.deepEqual(await makeTurnOn(store, subscribers).run(RUN_ID), { phase: "declined" });
  await subscribers.finish(RUN_ID);
  assert.equal(await reading, "data: [DONE]\n\n");
});
