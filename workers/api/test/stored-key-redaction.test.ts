import assert from "node:assert/strict";
import { test } from "node:test";
import type { AgentHarnessTool } from "@earendil-works/pi-agent-core";
import { fauxAssistantMessage, fauxText, fauxThinking, fauxToolCall } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { guardedStore, promptThrough, storedForms, storedRecords, type GuardedStore } from "./doubles/guarded-store.ts";

/**
 * KeyRedactingStorage, the store the session harness commits through: a bound BYOK key reaches storage only as
 * [redacted], in every record a real harness writes. That covers the prompt, the answer and its thinking and the frames
 * they stream through, tool-call arguments, tool results and provider error text. The fixture keys are made up, and
 * shape-based redaction does not catch them.
 */

const KEY = "caller-echo-key-7f3a";
const ESCAPED_KEY = 'caller"echo\\key-7f3a';

const noteParameters = Type.Object({ text: Type.String() });
const note: AgentHarnessTool<object, typeof noteParameters> = { name: "note", label: "Note", description: "Notes a text.",
  parameters: noteParameters, execute: () => Promise.resolve({ content: [{ type: "text", text: "Noted." }], details: null, terminate: true }) };

const lookupParameters = Type.Object({});
const lookup: AgentHarnessTool<object, typeof lookupParameters> = { name: "lookup", label: "Look up", description: "Reports what it found.",
  parameters: lookupParameters, execute: () => Promise.resolve({ content: [{ type: "text", text: `Found ${KEY}` }], details: { found: KEY }, terminate: true }) };

/** The forms of `key` the store received anywhere, interrupted streams included; empty when nothing leaked. */
function leaked(store: GuardedStore, key: string) {
  const stored = storedRecords(store);
  return storedForms(key).filter((form) => stored.includes(form));
}

void test("a key the provider streams back is stored as [redacted] in the answer, its thinking and every frame they stream through", async () => {
  const { store, session } = await guardedStore([KEY]);
  await promptThrough(session, "Hello", [fauxAssistantMessage([fauxThinking(`Thinking about ${KEY}`), fauxText(`Your key is ${KEY}.`)])]);
  assert.deepEqual(leaked(store, KEY), []);
  assert.ok(storedRecords(store).includes("Your key is [redacted]."));
  assert.ok(storedRecords(store).includes("Thinking about [redacted]"));
});

void test("a key that JSON escapes is stored as [redacted] in tool-call arguments", async () => {
  const { store, session } = await guardedStore([ESCAPED_KEY]);
  await promptThrough(session, "Hello", [fauxAssistantMessage(fauxToolCall("note", { text: `Use ${ESCAPED_KEY}` }), { stopReason: "toolUse" })], [note]);
  assert.deepEqual(leaked(store, ESCAPED_KEY), []);
  assert.ok(storedRecords(store).includes("Use [redacted]"));
});

void test("a key used as a property name in tool-call arguments is stored as [redacted]", async () => {
  const { store, session } = await guardedStore([KEY]);
  await promptThrough(session, "Hello", [fauxAssistantMessage(fauxToolCall("lookup", { [KEY]: "x" }), { stopReason: "toolUse" })], [lookup]);
  assert.deepEqual(leaked(store, KEY), []);
  assert.ok(storedRecords(store).includes('"[redacted]":"x"'));
});

void test("a tool result carrying the key is stored as [redacted]", async () => {
  const { store, session } = await guardedStore([KEY]);
  await promptThrough(session, "Hello", [fauxAssistantMessage(fauxToolCall("lookup", {}), { stopReason: "toolUse" })], [lookup]);
  assert.deepEqual(leaked(store, KEY), []);
  assert.ok(storedRecords(store).includes("Found [redacted]"));
});

void test("provider error text carrying the key is stored as [redacted] in the answer, the retry wait and the result", async () => {
  const { store, session } = await guardedStore([KEY]);
  const failure = () => fauxAssistantMessage([], { stopReason: "error", errorMessage: `503 overloaded for ${KEY}` });
  const outcome = await promptThrough(session, "Hello", [failure(), failure()]);
  assert.ok(outcome.ok);
  assert.equal(outcome.value.status, "failed");
  assert.deepEqual(leaked(store, KEY), []);
  assert.ok(storedRecords(store).includes('"at":"assistant.retry_wait"'), "the first failure waits to retry");
  assert.ok(storedRecords(store).includes("503 overloaded for [redacted]"));
});

void test("the user's own prompt is stored as [redacted], and the model reads the prompt back that way", async () => {
  const { store, session } = await guardedStore([KEY]);
  const requests: string[] = [];
  await promptThrough(session, `My key is ${KEY}`, [(context) => { requests.push(JSON.stringify(context.messages)); return fauxAssistantMessage("Noted."); }]);
  assert.deepEqual(leaked(store, KEY), []);
  assert.deepEqual(requests.map((request) => [request.includes("My key is [redacted]"), request.includes(KEY)]), [[true, false]]);
});
