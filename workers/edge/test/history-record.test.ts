/**
 * Ticket 4 of #1996 (#2004): the widened history projection keeps its four
 * filters. Each test is written so the filter it names is the load-bearing
 * line: remove it and the marker it hides appears (or the projection throws).
 *
 * test-type: unit.
 */
import assert from "node:assert/strict";
import test from "node:test";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { Entry, UsageRow } from "@earendil-works/pi-agent-core/harness/session";
import type { JsonValue, Usage } from "@earendil-works/pi-ai";
import { fauxAssistantMessage, fauxText, fauxThinking } from "@earendil-works/pi-ai";
import { projectHistory } from "../src/agent/views/history-record.ts";
import { SecretScrub } from "../src/agent/egress/secret-scrub.ts";

function messageEntry(id: string, seq: number, message: AgentMessage): Entry {
  return { id, parentId: null, seq, timestamp: 0, type: "message", message };
}

function toolEntry(id: string, seq: number, toolName: string, details: JsonValue, isError = false): Entry {
  return messageEntry(id, seq, { role: "toolResult", toolCallId: `call-${id}`, toolName, content: [{ type: "text", text: "ok" }], details, isError, timestamp: 0 });
}

function usage(input: number, output: number): Usage {
  return { input, output, cacheRead: 0, cacheWrite: 0, totalTokens: input + output, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
}

function usageRow(id: string, seq: number, entryId: string, values: Usage): UsageRow {
  return { id, seq, usage: values, entryId, adjustment: false };
}

const assistant = (id: string, seq: number, content: Parameters<typeof fauxAssistantMessage>[0] = "answer") =>
  messageEntry(id, seq, fauxAssistantMessage(content));

function publicPayload(record: ReturnType<typeof projectHistory>) {
  return JSON.stringify({ messages: record.messages.map((item) => item.message), toolResults: record.toolResults, modelCalls: record.modelCalls });
}

void test("a thinking part never crosses the projection", () => {
  const record = projectHistory([assistant("a1", 1, [fauxThinking("THINKING_SECRET"), fauxText("visible answer")])], [], new Map(), new SecretScrub());
  assert.equal(record.messages.length, 1);
  assert.equal(record.messages[0]?.message.content, "visible answer");
  assert.doesNotMatch(publicPayload(record), /THINKING_SECRET/);
});

void test("compaction summaries and non-selection custom entries never cross the projection", () => {
  const compaction: Entry = { id: "cmp", parentId: null, seq: 1, timestamp: 0, type: "compaction", summary: "COMPACTION_SECRET", retainedTail: [], tokensBefore: 0, fromHook: false };
  const custom: Entry = { id: "cus", parentId: null, seq: 2, timestamp: 0, type: "custom", customType: "other", data: "CUSTOM_SECRET" };
  const record = projectHistory([compaction, custom], [], new Map(), new SecretScrub());
  assert.deepEqual(record.messages, []);
  assert.deepEqual(record.toolResults, []);
  assert.deepEqual(record.modelCalls, []);
});

void test("a usage row whose entry is not on this visible lane is never returned", () => {
  const record = projectHistory([assistant("a1", 1)], [usageRow("u1", 1, "a1", usage(1, 2)), usageRow("u2", 2, "other-lane", usage(9, 9))], new Map(), new SecretScrub());
  assert.deepEqual(record.modelCalls.map((call) => call.usage.input), [1]);
  assert.equal(record.modelCalls[0]?.model, "faux-1");
});

void test("credentials and BYOK material never cross the projection", () => {
  const user = messageEntry("u1", 1, { role: "user", content: "OPAQUE_CREDENTIAL", timestamp: 0 });
  const tool = toolEntry("t1", 2, "search_bangumi", { token: "OPAQUE_CREDENTIAL", note: "sk-abcdefghijkl" });
  const record = projectHistory([user, tool], [], new Map(), new SecretScrub(["OPAQUE_CREDENTIAL"]));
  assert.equal(record.messages[0]?.message.content, "[redacted]");
  assert.doesNotMatch(publicPayload(record), /OPAQUE_CREDENTIAL|sk-abcdefghijkl/);
});

void test("every tool result is returned, and the fallback's own identity with it", () => {
  const record = projectHistory([
    toolEntry("t1", 1, "search_bangumi", { rows: [] }),
    toolEntry("t2", 2, "translate_anime_title", { translated: "Your Name", provider: "faux", model: "faux-1" }),
    toolEntry("t3", 3, "respond", { intent: "greet_user", success: true, message: "Hello" }),
  ], [usageRow("u1", 3, "t2", usage(7, 3))], new Map(), new SecretScrub());
  assert.deepEqual(record.toolResults.map((result) => result.tool_name), ["search_bangumi", "translate_anime_title", "respond"]);
  assert.equal(record.modelCalls.length, 1);
  assert.deepEqual(record.modelCalls[0], { provider: "faux", model: "faux-1", usage: { input: 7, output: 3, cache_read: 0, cache_write: 0, total_tokens: 10, cost: { input: 0, output: 0, cache_read: 0, cache_write: 0, total: 0 } } });
});
