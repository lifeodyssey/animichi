import assert from "node:assert/strict";
import { test } from "node:test";
import type { AgentHarnessTool } from "@earendil-works/pi-agent-core";
import type { Write } from "@earendil-works/pi-agent-core/harness/session";
import { fauxAssistantMessage, fauxText, fauxThinking, fauxToolCall } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { guardedSession, guardedStore, isFrameAppend, promptThrough, replayedStreams, storedRecords } from "./doubles/guarded-store.ts";

/**
 * KeyRedactingStorage changes nothing it does not have to. With no key bound, the store receives the harness's own
 * writes. With a bound key that is never echoed, every record is stored as committed and the streamed frames replay
 * to the same answer. Ids and discriminators are kept as committed, so a cold host restores the lane and drives on.
 */

const KEY = "caller-echo-key-7f3a";
/** Text holding no bound key, which a shape-based scrub would still rewrite; the store keeps it exactly. */
const UNBOUND_TEXT = "Use sk-notakey00000000 with Bearer notatoken0000";

const noteParameters = Type.Object({ body: Type.String() });
const note: AgentHarnessTool<object, typeof noteParameters> = { name: "note", label: "Note", description: "Notes a text.",
  parameters: noteParameters, execute: () => Promise.resolve({ content: [{ type: "text", text: "Noted." }], details: null, terminate: true }) };

/** One answer that thinks, writes and calls the note tool, every block holding `text`. */
function answering(text: string) {
  return fauxAssistantMessage([fauxThinking(text), fauxText(text), fauxToolCall("note", { body: text })], { stopReason: "toolUse" });
}

const isRecordWrite = (write: Write) => !isFrameAppend(write);

void test("with no key bound, the store receives the very writes the harness commits", async () => {
  const { store, committed, session } = await guardedStore([]);
  await promptThrough(session, UNBOUND_TEXT, [answering(UNBOUND_TEXT)], [note]);
  const sent = committed.getCommitAttempts();
  assert.ok(sent.length > 0);
  assert.deepEqual(store.received.getCommitAttempts().map((writes, index) => writes === sent[index]), sent.map(() => true));
});

void test("with a bound key that is never echoed, every record is stored as committed and the frames replay to the same answer", async () => {
  const { store, committed, session } = await guardedStore([KEY]);
  await promptThrough(session, UNBOUND_TEXT, [answering(UNBOUND_TEXT)], [note]);
  const sent = committed.getCommitAttempts().flat();
  const received = store.received.getCommitAttempts().flat();
  assert.deepStrictEqual(received.filter(isRecordWrite), sent.filter(isRecordWrite));
  assert.deepStrictEqual(replayedStreams(received, false), replayedStreams(sent, false));
  assert.ok(storedRecords(store).includes(UNBOUND_TEXT));
});

void test("ids and discriminators are kept as committed while the key is redacted from content: a cold host drives a second turn", async () => {
  const { store, session } = await guardedStore(["1", "x"]);
  const first = await promptThrough(session, "Room 101", [answering("Room 101")], [note]);
  const second = await promptThrough(guardedSession(store, []).session, "Again", [fauxAssistantMessage("Done.")], [note]);
  assert.ok(first.ok);
  assert.ok(second.ok);
  assert.deepEqual([first.value.status, second.value.status], ["completed", "completed"]);
  assert.ok(storedRecords(store).includes("Room [redacted]0[redacted]"), "the key is still redacted from content");
});
