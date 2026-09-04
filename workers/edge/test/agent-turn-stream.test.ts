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
import { UNANSWERED_TURN } from "../src/agent/session/turn-answer.ts";
import type { SseTurnChannel } from "../src/agent/session/sse-turn-channel.ts";
import { TurnSubscribers } from "../src/agent/session/turn-subscribers.ts";
import { InMemoryTurnStore } from "./doubles/in-memory-turn-store.ts";
import { CountingSpotLookup, makeScriptedTurnModel, makeTurnAnswering, makeUserTranscript } from "./doubles/make-turn-parts.ts";

const RUN_ID = "run-1";
const NOW = 1_000;

async function readAll(body: ReadableStream<Uint8Array>): Promise<string> {
  return await new Response(body).text();
}

/** The live view of a run the session still owes work for — the only door
 * onto a channel, and the case every frame test below is about. */
async function liveView(subscribers: TurnSubscribers): Promise<SseTurnChannel> {
  const view = await subscribers.openLiveView(RUN_ID, Promise.resolve(true));
  assert.ok(view);
  return view;
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
    model: makeScriptedTurnModel(),
    answering: makeTurnAnswering(),
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
  const closed = closingFrames({ phase: "failed", reason: "provider_failed" }, UNANSWERED_TURN);
  assert.deepEqual(closed.map((frame) => frame.type), ["error", "finish-step", "finish"]);
  assert.deepEqual(closingFrames({ phase: "succeeded" }, UNANSWERED_TURN).at(-1), {
    type: "finish",
    finishReason: "stop",
  });
});

/** The client is read CONCURRENTLY on purpose: the channel awaits every write,
 * so the frames arrive under the protocol's own backpressure rather than into a
 * buffer a test drained afterwards. */
void test("a registered subscriber reads the turn's frames and its terminator", async () => {
  const subscribers = new TurnSubscribers();
  const reading = readAll((await liveView(subscribers)).body);
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
  const channel = await liveView(subscribers);
  await channel.body.cancel();
  assert.deepEqual(await makeTurn(subscribers).run(RUN_ID), { phase: "succeeded" });
  assert.equal(channel.clientGone, true);
});

void test("a turn nobody is watching still runs to its ending", async () => {
  const subscribers = new TurnSubscribers();
  assert.deepEqual(await makeTurn(subscribers).run(RUN_ID), { phase: "succeeded" });
});

/** A turn that never opened writes no stream, so a subscriber on it sees only
 * the terminator: this incarnation never hosted the turn, and inventing `start`
 * / `finish` frames for one it does not own would contradict the owner's. */
void test("a turn whose run already settled writes no frames to a subscriber", async () => {
  const subscribers = new TurnSubscribers();
  const reading = readAll((await liveView(subscribers)).body);
  const store = makeStore();
  await store.settleFailed(RUN_ID, "cancelled", new Date(NOW));
  assert.deepEqual(await makeTurnOn(store, subscribers).run(RUN_ID), { phase: "already_settled" });
  await subscribers.finish(RUN_ID);
  assert.equal(await reading, "data: [DONE]\n\n");
});

/** The registration race (#1254). A `GET /stream` reads the session's storage
 * queue, and the alarm can drive the run to its ending while that read is in
 * flight — the read then answers "still queued" about a turn that is already
 * over. The check therefore has to settle inside the subscriber set, next to
 * the registration: settled anywhere earlier, this hands the client a channel
 * nothing will ever write a frame or a terminator to. */
void test("a turn that ends while the queue check is in flight opens no live view", async () => {
  const subscribers = new TurnSubscribers();
  let sayQueued: (owed: boolean) => void = () => undefined;
  const queueRead = new Promise<boolean>((resolve) => {
    sayQueued = resolve;
  });
  const opening = subscribers.openLiveView(RUN_ID, queueRead);
  await subscribers.finish(RUN_ID);
  sayQueued(true);
  assert.equal(await opening, null);
});

/** The plain refusal: this session owes no work for the run at all. */
void test("a run this session does not owe work for opens no live view", async () => {
  const subscribers = new TurnSubscribers();
  assert.equal(await subscribers.openLiveView(RUN_ID, Promise.resolve(false)), null);
});

/** The same race one step earlier: writing a terminator awaits a reader, so a
 * turn can be ENDING for as long as a subscriber takes to read. A view opened
 * in that window is refused too — the ending has already walked past the list
 * it would have joined. */
void test("a view opened while the turn's terminators are still going out is refused", async () => {
  const subscribers = new TurnSubscribers();
  const channel = await liveView(subscribers);
  const finishing = subscribers.finish(RUN_ID);
  assert.equal(await subscribers.openLiveView(RUN_ID, Promise.resolve(true)), null);
  const drained = readAll(channel.body);
  await finishing;
  assert.equal(await drained, "data: [DONE]\n\n");
});
