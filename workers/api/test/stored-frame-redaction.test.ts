import assert from "node:assert/strict";
import { test } from "node:test";
import { BACKGROUND_CONTEXT } from "@earendil-works/pi-agent-core/harness/context";
import { appendList, list, type Storage } from "@earendil-works/pi-agent-core/harness/session";
import { fauxAssistantMessage, type AssistantMessageFrame } from "@earendil-works/pi-ai";
import { guardedStore, isFrameAppend, replayedStreams, storedForms, storedRecords, type GuardedStore } from "./doubles/guarded-store.ts";

/**
 * KeyRedactingStorage on the frames pi appends while an answer streams, one commit per chunk, written here by hand in
 * the shapes pi-ai's frame encoder writes them. No stored frame holds a bound key or any part of one, the frames
 * replay with the key as [redacted], and frames that never held the key replay to the same text.
 */

const KEY = "caller-echo-key-7f3a";
type FrameList = ReturnType<typeof list<AssistantMessageFrame>>;
type TextDelta = Extract<AssistantMessageFrame, { type: "text_delta" }>;
const ANSWER: FrameList = list<AssistantMessageFrame>("pi.pending.assistant_frame", "operation:answer");
const OTHER: FrameList = list<AssistantMessageFrame>("pi.pending.assistant_frame", "operation:other");
const START: AssistantMessageFrame = { type: "start", partial: fauxAssistantMessage([]) };
const textStart = (contentIndex: number): AssistantMessageFrame => ({ type: "text_start", contentIndex, content: { type: "text", text: "" } });

/** Commits each frame as a write of its own, in order, as pi does while answers stream. */
async function stream(storage: Storage, frames: readonly (readonly [FrameList, AssistantMessageFrame])[]) {
  for (const [address, frame] of frames) await storage.commit([appendList(address, frame)], BACKGROUND_CONTEXT);
}

/** The chunks the store received for block `contentIndex` of the answer at `address`. */
function receivedDeltas(store: GuardedStore, address: FrameList, contentIndex: number) {
  const frames = store.received.getCommitAttempts().flat().filter(isFrameAppend).filter((write) => write.key === address.key)
    .map((write) => write.value as AssistantMessageFrame);
  return frames.filter((frame): frame is TextDelta => frame.type === "text_delta" && frame.contentIndex === contentIndex).map((frame) => frame.delta);
}

void test("a tool call's start and checkpoint frames hold no part of the key, and the replayed stream holds [redacted]", async () => {
  const { store, committed } = await guardedStore([KEY]);
  await stream(committed, [[ANSWER, START],
    [ANSWER, { type: "toolcall_start", contentIndex: 0, toolCall: { type: "toolCall", id: "call", name: "note", arguments: { text: "Use caller-ec" } } }],
    [ANSWER, { type: "toolcall_checkpoint", contentIndex: 0, json: '{"text":"Use caller-ec' }],
    [ANSWER, { type: "toolcall_delta", contentIndex: 0, delta: 'ho-key-7f3a"}' }]]);
  assert.deepEqual(storedForms(KEY).filter((form) => storedRecords(store).includes(form)), []);
  assert.deepEqual(storedForms("caller-ec").filter((form) => storedRecords(store).includes(form)), [], "no part of the key is stored either");
  assert.ok(storedRecords(store).includes('"text":"Use [redacted]"'));
});

void test("the chunks of each block and each stream are redacted independently of every other", async () => {
  const { store, committed } = await guardedStore([KEY]);
  await stream(committed, [[ANSWER, START], [OTHER, START], [ANSWER, textStart(0)],
    [ANSWER, { type: "text_delta", contentIndex: 0, delta: "Use caller-ec" }],
    [OTHER, textStart(0)], [OTHER, { type: "text_delta", contentIndex: 0, delta: "ho-key-7f3a" }],
    [ANSWER, textStart(1)], [ANSWER, { type: "text_delta", contentIndex: 1, delta: "ho-key-7f3a" }]]);
  assert.deepEqual([receivedDeltas(store, ANSWER, 0), receivedDeltas(store, OTHER, 0), receivedDeltas(store, ANSWER, 1)],
    [["Use "], ["ho-key-7f3a"], ["ho-key-7f3a"]]);
});

void test("with a key that is never echoed, the frames replay to the same text", async () => {
  const { store, committed } = await guardedStore([KEY]);
  await stream(committed, [[ANSWER, START], [ANSWER, textStart(0)],
    [ANSWER, { type: "text_delta", contentIndex: 0, delta: "Use a ca" }], [ANSWER, { type: "text_delta", contentIndex: 0, delta: "ll: done" }]]);
  assert.deepEqual(receivedDeltas(store, ANSWER, 0), ["Use a ", "call: done"]);
  assert.deepStrictEqual(replayedStreams(store.received.getCommitAttempts().flat(), true), replayedStreams(committed.getCommitAttempts().flat(), true));
});

void test("a thinking block's frames hold no part of the key, and they replay to [redacted]", async () => {
  const { store, committed } = await guardedStore([KEY]);
  await stream(committed, [[ANSWER, START], [ANSWER, { type: "thinking_start", contentIndex: 0, content: { type: "thinking", thinking: "" } }],
    [ANSWER, { type: "thinking_delta", contentIndex: 0, delta: "Use caller-ec" }], [ANSWER, { type: "thinking_delta", contentIndex: 0, delta: "ho-key-7f3a" }]]);
  assert.deepEqual(storedForms("caller-ec").filter((form) => storedRecords(store).includes(form)), []);
  assert.ok(storedRecords(store).includes('"thinking":"Use [redacted]"'));
});

void test("a start frame's provider diagnostics are stored with [redacted] for the key", async () => {
  const { store, committed } = await guardedStore([KEY]);
  const diagnostic = { type: "provider_error", timestamp: 1, error: { message: `Rejected ${KEY}` } };
  await stream(committed, [[ANSWER, { type: "start", partial: { ...fauxAssistantMessage([]), diagnostics: [diagnostic] } }]]);
  assert.deepEqual(storedForms(KEY).filter((form) => storedRecords(store).includes(form)), []);
  assert.ok(storedRecords(store).includes('"message":"Rejected [redacted]"'));
});
