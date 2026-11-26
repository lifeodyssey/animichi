import assert from "node:assert/strict";
import { test } from "node:test";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { BACKGROUND_CONTEXT } from "@earendil-works/pi-agent-core/harness/context";
import { entryLabel, operationPreparation, operationToolArgs, operationToolMemo, pendingToolOutput, sessionName, setValue,
  type ValueSetWrite, type Write } from "@earendil-works/pi-agent-core/harness/session";
import { guardedStore, type GuardedStore } from "./doubles/guarded-store.ts";

/**
 * KeyRedactingStorage on the values and entries pi stores beside an answer, written here by hand in pi's own types:
 * staged tool output, tool arguments and memos, the session's name, entry labels, the preparation of a compaction or
 * a branch summary, and a compaction entry. A bound key is stored as [redacted] in each, and ids and discriminators
 * are kept as committed. Where two property names become the same once redacted, only the later one is kept.
 */

const KEY = "caller-echo-key-7f3a";
const OTHER_KEY = "other-echo-key-2b9c";
const SETTINGS = { enabled: true, reserveTokens: 1, keepRecentTokens: 1 };
const user = (text: string): AgentMessage => ({ role: "user", content: text, timestamp: 1 });
const files = (read: string[], written: string[]) => ({ read, written, edited: [] });
const isValueSet = (write: Write): write is ValueSetWrite => write.kind === "value" && write.op === "set";

/** The value of every value write the store received, in commit order. */
function receivedValues(store: GuardedStore): unknown[] {
  return store.received.getCommitAttempts().flat().filter(isValueSet).map((write) => write.value);
}

void test("staged tool output, tool arguments, tool memos, the session name and entry labels are stored with [redacted] for the key", async () => {
  const { store, committed } = await guardedStore([KEY]);
  await committed.commit([
    setValue(pendingToolOutput("operation", "call"), { content: [{ type: "text", text: `Found ${KEY}` }], details: { found: KEY } }),
    setValue(operationToolArgs("operation", "step", 0), { text: `Use ${KEY}` }),
    setValue(operationToolMemo("operation", "call", "lookup"), { seen: [KEY] }),
    setValue(sessionName, `Trip with ${KEY}`),
    setValue(entryLabel("entry"), `Saved ${KEY}`),
  ], BACKGROUND_CONTEXT);
  assert.deepEqual(receivedValues(store), [
    { content: [{ type: "text", text: "Found [redacted]" }], details: { found: "[redacted]" } },
    { text: "Use [redacted]" }, { seen: ["[redacted]"] }, "Trip with [redacted]", "Saved [redacted]",
  ]);
});

void test("when two property names of tool arguments become the same once redacted, only the later one is stored", async () => {
  const { store, committed } = await guardedStore([KEY, OTHER_KEY]);
  const args = { [`${KEY} id`]: "first", [`${OTHER_KEY} id`]: "second" };
  await committed.commit([setValue(operationToolArgs("operation", "step", 0), args)], BACKGROUND_CONTEXT);
  assert.deepEqual(receivedValues(store), [{ "[redacted] id": "second" }]);
});

void test("a compaction's and a branch summary's preparation are stored with [redacted] for the key in every message, summary and file", async () => {
  const { store, committed } = await guardedStore([KEY]);
  await committed.commit([
    setValue(operationPreparation("operation", "compaction"), { kind: "compaction", messagesToSummarize: [user(`A ${KEY}`)],
      turnPrefixMessages: [user(`B ${KEY}`)], retainedTail: [user(`C ${KEY}`)], isSplitTurn: false, tokensBefore: 1,
      previousSummary: `D ${KEY}`, fileOps: files([`E ${KEY}`], []), settings: SETTINGS }),
    setValue(operationPreparation("operation", "branch"), { kind: "branch_summary", messages: [user(`F ${KEY}`)],
      fileOps: files([], [`G ${KEY}`]), totalTokens: 1 }),
  ], BACKGROUND_CONTEXT);
  assert.deepEqual(receivedValues(store), [
    { kind: "compaction", messagesToSummarize: [user("A [redacted]")], turnPrefixMessages: [user("B [redacted]")],
      retainedTail: [user("C [redacted]")], isSplitTurn: false, tokensBefore: 1, previousSummary: "D [redacted]",
      fileOps: files(["E [redacted]"], []), settings: SETTINGS },
    { kind: "branch_summary", messages: [user("F [redacted]")], fileOps: files([], ["G [redacted]"]), totalTokens: 1 },
  ]);
});

void test("a compaction entry's retained messages keep their ids as committed while the key is redacted from their content", async () => {
  const { store, committed } = await guardedStore(["1"]);
  const retained = (text: string): AgentMessage => ({ role: "toolResult", toolCallId: "call-1", toolName: "note",
    content: [{ type: "text", text }], isError: false, timestamp: 1 });
  const compaction = (summary: string, text: string): Write => ({ kind: "entry", entry: { id: "entry-1", parentId: null,
    type: "compaction", summary, retainedTail: [retained(text)], tokensBefore: 1, fromHook: false } });
  await committed.commit([compaction("Kept 1", "Room 101")], BACKGROUND_CONTEXT);
  assert.deepEqual(store.received.getCommitAttempts().flat(), [compaction("Kept [redacted]", "Room [redacted]0[redacted]")]);
});
