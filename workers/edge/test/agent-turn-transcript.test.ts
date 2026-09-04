/**
 * W1-3 (#1252): the transcript a retried alarm resumes from (spec Appendix C).
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
import type { AssistantMessage } from "@earendil-works/pi-ai";
import { seededMessages } from "../src/agent/session/turn-transcript.ts";
import { asJsonValue } from "../src/agent/session/turn-store.ts";
import { mimoModel } from "../src/agent/session/turn-model.ts";
import type {
  LoadedTurn,
  PersistedStep,
  StepResult,
  TranscriptRow,
} from "../src/agent/session/turn-store.ts";

const RUN_ID = "run-1";
const MODEL = mimoModel();
const RESULT: StepResult = { content: [{ type: "text", text: "Takayama" }], details: null };

function makeToolCallMessage(...ids: string[]): AssistantMessage {
  return {
    role: "assistant",
    content: ids.map((id) => ({ type: "toolCall", id, name: "lookup_spot", arguments: {} })),
    api: "openai-completions",
    provider: "mimo",
    model: MODEL.id,
    usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason: "toolUse",
    timestamp: 0,
  };
}

function makeToolCallRow(runId: string, stepIndex: number, message: AssistantMessage): TranscriptRow {
  const envelope = { run_id: runId, step_index: stepIndex, message };
  return { role: "assistant", content: "", responseData: asJsonValue(envelope) };
}

function makeStep(stepIndex: number, result: StepResult | null): PersistedStep {
  return { stepIndex, toolName: "lookup_spot", input: {}, result };
}

function makeTurn(transcript: TranscriptRow[], steps: PersistedStep[] = []): LoadedTurn {
  return {
    runId: RUN_ID, sessionId: "session-1", deadlineAt: 0, transcript, steps,
    callerKeyed: false, selection: null,
  };
}

const USER: TranscriptRow = { role: "user", content: "Hyouka の聖地は？", responseData: null };

void test("a fresh turn seeds exactly the user message", () => {
  assert.deepEqual(seededMessages(makeTurn([USER]), MODEL), [
    { role: "user", content: "Hyouka の聖地は？", timestamp: 0 },
  ]);
});

void test("a persisted tool call comes back answered by its persisted step", () => {
  const message = makeToolCallMessage("call-1");
  const turn = makeTurn([USER, makeToolCallRow(RUN_ID, 0, message)], [makeStep(0, RESULT)]);
  const seeded = seededMessages(turn, MODEL);
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
  const turn = makeTurn([USER, makeToolCallRow(RUN_ID, 0, makeToolCallMessage("call-1"))], []);
  assert.deepEqual(seededMessages(turn, MODEL), [
    { role: "user", content: "Hyouka の聖地は？", timestamp: 0 },
  ]);
});

void test("a batch answered only in part truncates rather than half-answering", () => {
  const message = makeToolCallMessage("call-1", "call-2");
  const turn = makeTurn([USER, makeToolCallRow(RUN_ID, 0, message)], [makeStep(0, RESULT)]);
  assert.equal(seededMessages(turn, MODEL).length, 1);
});

void test("an earlier turn's tool-call row is read as its plain text, not answered", () => {
  const row = makeToolCallRow("run-0", 0, makeToolCallMessage("old-call"));
  const seeded = seededMessages(makeTurn([{ ...row, content: "前の答え" }, USER]), MODEL);
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

void test("an earlier turn's empty tool-call row contributes nothing at all", () => {
  const row = makeToolCallRow("run-0", 0, makeToolCallMessage("old-call"));
  assert.equal(seededMessages(makeTurn([row, USER]), MODEL).length, 1);
});
