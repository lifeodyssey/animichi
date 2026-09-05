/**
 * W1-3 (#1252): the crash branch of the transcript a retried alarm resumes
 * from (spec Appendix C). What the SESSION's earlier turns contribute is
 * `agent-turn-transcript-replay.test.ts` (#1377).
 *
 * The property under test is the one the spike made a hard requirement: an
 * assistant tool-call message persisted with its `run_steps` row comes back as
 * an assistant message ANSWERED by that row, so the loop continues instead of
 * re-deriving calls whose `step_index` would then mean something else.
 *
 * test-type: unit (pure function; no clock, no I/O).
 */
import test from "node:test";
import assert from "node:assert/strict";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { resumedTranscript } from "../src/agent/session/turn-transcript.ts";
import type { LoadedTurn } from "../src/agent/session/turn-store.ts";
import {
  makeLoadedTurn,
  makeStep,
  makeStepResult,
  makeToolCallMessage,
  makeToolCallRow,
  MODEL,
  RUN_ID,
  USER_MESSAGE,
  USER_ROW,
} from "./doubles/make-loaded-turn.ts";

const RESULT = makeStepResult("Takayama");

/** The messages half of the rebuild, which is what most of these are about. */
function seededMessages(turn: LoadedTurn): AgentMessage[] {
  return resumedTranscript(turn, MODEL).messages;
}

void test("a fresh turn seeds exactly the user message", () => {
  assert.deepEqual(seededMessages(makeLoadedTurn({ transcript: [USER_ROW] })), [USER_MESSAGE]);
});

void test("a persisted tool call comes back answered by its persisted step", () => {
  const message = makeToolCallMessage("call-1");
  const transcript = [USER_ROW, makeToolCallRow(RUN_ID, 0, message)];
  const seeded = seededMessages(makeLoadedTurn({ transcript, steps: [makeStep(0, RESULT)] }));
  assert.equal(seeded.length, 3);
  assert.deepEqual(seeded[1], message);
  assert.deepEqual(seeded[2], {
    role: "toolResult",
    toolCallId: "call-1",
    toolName: "lookup_spot",
    content: RESULT.content,
    details: null,
    isError: false,
    timestamp: 0,
  });
});

void test("a tool call whose step never landed truncates the transcript", () => {
  const transcript = [USER_ROW, makeToolCallRow(RUN_ID, 0, makeToolCallMessage("call-1"))];
  assert.deepEqual(seededMessages(makeLoadedTurn({ transcript })), [USER_MESSAGE]);
});

void test("a batch answered only in part truncates rather than half-answering", () => {
  const transcript = [USER_ROW, makeToolCallRow(RUN_ID, 0, makeToolCallMessage("call-1", "call-2"))];
  const turn = makeLoadedTurn({ transcript, steps: [makeStep(0, RESULT)] });
  assert.equal(seededMessages(turn).length, 1);
});

void test("an assistant row that issued no calls comes back as its plain text", () => {
  const answer = { role: "assistant" as const, content: "前の答え", responseData: null };
  const seeded = seededMessages(makeLoadedTurn({ transcript: [answer, USER_ROW] }));
  assert.equal(seeded.length, 2);
  assert.deepEqual(seeded[0], {
    role: "assistant",
    content: [{ type: "text", text: "前の答え" }],
    api: MODEL.api,
    provider: MODEL.provider,
    model: MODEL.id,
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason: "stop",
    timestamp: 0,
  });
});

void test("an empty assistant row contributes nothing at all", () => {
  const empty = { role: "assistant" as const, content: "", responseData: null };
  assert.equal(seededMessages(makeLoadedTurn({ transcript: [empty, USER_ROW] })).length, 1);
});

void test("the rebuild reports how many of this run's steps it already answers", () => {
  const transcript = [USER_ROW, makeToolCallRow(RUN_ID, 0, makeToolCallMessage("call-1"))];
  const turn = makeLoadedTurn({ transcript, steps: [makeStep(0, RESULT)] });
  assert.equal(resumedTranscript(turn, MODEL).settledSteps, 1);
});

void test("a truncated batch resumes no steps, so they are replayed in place", () => {
  const transcript = [USER_ROW, makeToolCallRow(RUN_ID, 0, makeToolCallMessage("call-1", "call-2"))];
  const turn = makeLoadedTurn({ transcript, steps: [makeStep(0, RESULT)] });
  assert.equal(resumedTranscript(turn, MODEL).settledSteps, 0);
});
