/**
 * #1377 (spec §九 9.1): the transcript replays EVERY turn's tool calls as
 * structured messages, not just this run's.
 *
 * The property under test is the anti-pattern pair 李博杰《深入理解 AI Agent》
 * ch.2 实验 2-3 names: an earlier turn's tool result must still be in the
 * context (no sliding window, so the model does not re-call a tool it was
 * already answered) and it must be there as `assistant` + `toolResult` messages
 * (no text formatting, so no attention is spent re-deriving the boundaries).
 * The pairing stays per-run, which is what the crash branch rests on.
 *
 * test-type: unit (pure function; no clock, no I/O).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { resumedTranscript } from "../src/agent/session/turn-transcript.ts";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { ToolResultMessage } from "@earendil-works/pi-ai";
import {
  makeAnswerRow,
  makeLoadedTurn,
  makeStep,
  makeStepResult,
  makeToolCallMessage,
  makeToolCallRow,
  MODEL,
  RUN_ID,
  USER_ROW,
} from "./doubles/make-loaded-turn.ts";

const FIRST_RUN = "run-0";
const SECOND_RUN = "run-2";
const FIRST_RESULT = makeStepResult("Takayama");
const SECOND_RESULT = makeStepResult("Kamiyama");

/** The two turns before this one: each a call, its result and its answer. */
const FIRST_CALL = makeToolCallMessage("call-a");
const SECOND_CALL = makeToolCallMessage("call-b");
const EARLIER_TURNS = [
  USER_ROW,
  makeToolCallRow(FIRST_RUN, 0, FIRST_CALL),
  makeAnswerRow("高山です"),
  USER_ROW,
  makeToolCallRow(SECOND_RUN, 0, SECOND_CALL),
  makeAnswerRow("神山です"),
];

const FIRST_STEPS = { runId: FIRST_RUN, steps: [makeStep(0, FIRST_RESULT)] };
const SECOND_STEPS = { runId: SECOND_RUN, steps: [makeStep(0, SECOND_RESULT)] };
const EARLIER_STEPS = [FIRST_STEPS, SECOND_STEPS];

function resultIn(messages: readonly AgentMessage[], index: number): ToolResultMessage {
  const message = messages[index];
  assert.ok(message?.role === "toolResult", "a tool result was seeded");
  return message;
}

void test("a third turn replays both earlier turns' calls as structured messages", () => {
  const turn = makeLoadedTurn({ transcript: [...EARLIER_TURNS, USER_ROW], earlierSteps: EARLIER_STEPS });
  const seeded = resumedTranscript(turn, MODEL).messages;
  assert.deepEqual(seeded.map((message) => message.role), [
    "user", "assistant", "toolResult", "assistant",
    "user", "assistant", "toolResult", "assistant",
    "user",
  ]);
  assert.deepEqual(seeded[1], FIRST_CALL);
  assert.deepEqual(resultIn(seeded, 2).content, FIRST_RESULT.content);
});

void test("an earlier turn's answer text is replayed after its tool result", () => {
  const turn = makeLoadedTurn({ transcript: [...EARLIER_TURNS, USER_ROW], earlierSteps: EARLIER_STEPS });
  const seeded = resumedTranscript(turn, MODEL).messages;
  assert.deepEqual(seeded[3], {
    role: "assistant",
    content: [{ type: "text", text: "高山です" }],
    api: MODEL.api,
    provider: MODEL.provider,
    model: MODEL.id,
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason: "stop",
    timestamp: 0,
  });
});

void test("an earlier run answers only its OWN step index, never this run's", () => {
  const mine = makeToolCallMessage("call-mine");
  const transcript = [USER_ROW, makeToolCallRow(FIRST_RUN, 0, FIRST_CALL), USER_ROW, makeToolCallRow(RUN_ID, 0, mine)];
  const earlierSteps = [{ runId: FIRST_RUN, steps: [makeStep(0, FIRST_RESULT)] }];
  const turn = makeLoadedTurn({ transcript, steps: [makeStep(0, SECOND_RESULT)], earlierSteps });
  const seeded = resumedTranscript(turn, MODEL).messages;
  assert.deepEqual(resultIn(seeded, 2).content, FIRST_RESULT.content);
  assert.deepEqual(resultIn(seeded, 5).content, SECOND_RESULT.content);
});

void test("an earlier run's unanswered call is left out, and the turns after it stay", () => {
  const crashed = makeToolCallRow(FIRST_RUN, 0, FIRST_CALL, "書きかけ");
  const transcript = [USER_ROW, crashed, ...EARLIER_TURNS.slice(3), USER_ROW];
  const turn = makeLoadedTurn({ transcript, earlierSteps: [SECOND_STEPS] });
  const seeded = resumedTranscript(turn, MODEL).messages;
  assert.deepEqual(seeded.map((message) => message.role), [
    "user", "user", "assistant", "toolResult", "assistant", "user",
  ]);
});

void test("an earlier run's unanswered call is never given an invented result", () => {
  const transcript = [USER_ROW, makeToolCallRow(FIRST_RUN, 0, FIRST_CALL), USER_ROW];
  const seeded = resumedTranscript(makeLoadedTurn({ transcript }), MODEL).messages;
  assert.equal(seeded.filter((message) => message.role === "toolResult").length, 0);
});

void test("the step count answers for THIS run only, with earlier turns replayed", () => {
  const mine = makeToolCallRow(RUN_ID, 0, makeToolCallMessage("call-mine"));
  const transcript = [...EARLIER_TURNS, USER_ROW, mine];
  const steps = [makeStep(0, SECOND_RESULT)];
  const turn = makeLoadedTurn({ transcript, steps, earlierSteps: EARLIER_STEPS });
  assert.equal(resumedTranscript(turn, MODEL).settledSteps, 1);
});

void test("this run's unanswered call still truncates, earlier turns replayed", () => {
  const mine = makeToolCallRow(RUN_ID, 0, makeToolCallMessage("call-mine"));
  const transcript = [...EARLIER_TURNS, USER_ROW, mine, makeAnswerRow("届かない")];
  const turn = makeLoadedTurn({ transcript, earlierSteps: EARLIER_STEPS });
  const resumed = resumedTranscript(turn, MODEL);
  assert.equal(resumed.messages.length, 9);
  assert.equal(resumed.settledSteps, 0);
});
