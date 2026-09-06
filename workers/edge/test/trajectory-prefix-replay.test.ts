/**
 * E-1 (#1380): what the NEXT turn of a seeded session actually sees.
 *
 * This is the property the seeding exists for, and it is asserted end to end
 * rather than on the projection alone: the rows here are the ones the seeding
 * WROTE through the store double, rebuilt by C-1's own `resumedTranscript`
 * (#1377). A prefix whose `run_steps` result went missing would leave the
 * transcript ending on an unanswered call, which that rebuild drops for an
 * earlier run — so the model would re-derive the call the prefix already made,
 * and every assertion below on the assistant turn goes red.
 *
 * The `<agent_status>` half is the other seam a seeded start reaches the model
 * through (#1379): the open question is a line on the bar, not a transcript row.
 *
 * test-type: unit.
 */
import test from "node:test";
import assert from "node:assert/strict";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { AssistantMessage, ToolCall, ToolResultMessage } from "@earendil-works/pi-ai";
import { agentStatusMessages, AGENT_STATUS_TAG } from "../src/agent/session/agent-status.ts";
import { seedTrajectoryPrefix } from "../src/agent/session/prefix-seeding.ts";
import { resumedTranscript } from "../src/agent/session/turn-transcript.ts";
import type { TranscriptRow } from "../src/agent/session/turn-store.ts";
import { makeLoadedTurn, MODEL, USER_ROW } from "./doubles/make-loaded-turn.ts";
import { makePrefixSeeding, SEEDED_RUN_ID, type PrefixSeedingHarness } from "./doubles/make-prefix-seeding.ts";
import { makePrefixSeedingRequest } from "./doubles/make-trajectory-prefix.ts";

const REQUEST = makePrefixSeedingRequest();

/** The session's `messages` rows after the seeding, in commit order: the user
 * turn, the tool-call row the store wrote, and the answer it settled. */
function seededRows(harness: PrefixSeedingHarness): TranscriptRow[] {
  const answer = harness.store.succeeded.at(0)?.answer ?? "";
  return [
    { role: "user", content: harness.opened.at(0)?.submission.text ?? "", responseData: null },
    ...harness.store.transcript,
    { role: "assistant", content: answer, responseData: null },
  ];
}

/** One seeded session, replayed as the transcript its NEXT run resumes from. */
async function replayedPrefix(): Promise<AgentMessage[]> {
  const harness = makePrefixSeeding();
  await seedTrajectoryPrefix(harness.parts, REQUEST);
  const turn = makeLoadedTurn({
    transcript: [...seededRows(harness), USER_ROW],
    earlierSteps: [{ runId: SEEDED_RUN_ID, steps: harness.store.steps }],
  });
  return resumedTranscript(turn, MODEL).messages;
}

function assistantIn(messages: readonly AgentMessage[], index: number): AssistantMessage {
  const message = messages[index];
  assert.ok(message?.role === "assistant", "an assistant message was replayed");
  return message;
}

/** The one call the assistant turn at `index` issued. */
function callIn(messages: readonly AgentMessage[], index: number): ToolCall {
  const call = assistantIn(messages, index).content.at(0);
  assert.ok(call?.type === "toolCall", "the replayed assistant turn issued a tool call");
  return call;
}

function resultIn(messages: readonly AgentMessage[], index: number): ToolResultMessage {
  const message = messages[index];
  assert.ok(message?.role === "toolResult", "a tool result was replayed");
  return message;
}

void test("the seeded turn replays as user, assistant tool call, tool result, answer", async () => {
  const messages = await replayedPrefix();

  assert.deepEqual(messages.map((message) => message.role), [
    "user", "assistant", "toolResult", "assistant", "user",
  ]);
});

void test("the replayed assistant turn carries the seeded call, not prose", async () => {
  const messages = await replayedPrefix();

  const call = callIn(messages, 1);
  assert.equal(call.name, "resolve_anime");
  assert.deepEqual(call.arguments, REQUEST.prefix.toolCall.params);
});

void test("the replayed tool result is the settled run_steps result, paired to that call", async () => {
  const messages = await replayedPrefix();

  const answered = resultIn(messages, 2);
  assert.equal(answered.toolCallId, callIn(messages, 1).id);
  assert.deepEqual(answered.content, [{ type: "text", text: REQUEST.prefix.toolCall.resultText }]);
});

void test("the seeded answer replays as the assistant's own words", async () => {
  const messages = await replayedPrefix();

  assert.deepEqual(assistantIn(messages, 3).content, [{ type: "text", text: REQUEST.prefix.assistantText }]);
});

void test("the agent status bar of the seeded session states the open question", async () => {
  const harness = makePrefixSeeding();
  await seedTrajectoryPrefix(harness.parts, REQUEST);

  const envelope = await harness.parts.envelopes.load();
  const [bar] = agentStatusMessages({ envelope, toolCalls: [] });
  assert.ok(bar?.role === "user" && typeof bar.content === "string", "the bar rides one user message");

  assert.ok(bar.content.includes(`<${AGENT_STATUS_TAG}>`));
  assert.ok(bar.content.includes("Open question: anime_ambiguity"));
  assert.ok(bar.content.includes("candidate_ids=[115908, 11291]"));
});
