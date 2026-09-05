/**
 * The rows and steps one alarm loads for one session (#1252, #1377).
 *
 * `resumedTranscript` reads three things — the session's `messages` rows, this
 * run's `run_steps` and the earlier runs' — so a case is written by naming the
 * rows it wants rather than by restating the whole `LoadedTurn` each time. Two
 * test files build on these: the crash-resume properties of one run, and the
 * structured replay of the turns before it.
 */
import type { AssistantMessage } from "@earendil-works/pi-ai";
import { mimoModel } from "../../src/agent/session/turn-model.ts";
import { asJsonValue } from "../../src/agent/session/turn-store.ts";
import type {
  LoadedTurn,
  PersistedStep,
  RunSteps,
  StepResult,
  TranscriptRow,
} from "../../src/agent/session/turn-store.ts";

export const RUN_ID = "run-1";
export const MODEL = mimoModel();
export const USER_ROW: TranscriptRow = { role: "user", content: "Hyouka の聖地は？", responseData: null };
export const USER_MESSAGE = { role: "user" as const, content: USER_ROW.content, timestamp: 0 };

/** One tool result, as `run_steps.result` stores it — with the short form
 * frozen when it was written, when the case is about one (#1378). */
export function makeStepResult(text: string, summary?: string): StepResult {
  return { content: [{ type: "text", text }], details: null, summary };
}

const NO_COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };

/** The assistant message that issued one turn's calls, one per id. */
export function makeToolCallMessage(...ids: string[]): AssistantMessage {
  return {
    role: "assistant",
    content: ids.map((id) => ({ type: "toolCall", id, name: "lookup_spot", arguments: {} })),
    api: "openai-completions",
    provider: "mimo",
    model: MODEL.id,
    usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: NO_COST },
    stopReason: "toolUse",
    timestamp: 0,
  };
}

/** The `messages` row that message was persisted as, with its envelope. */
export function makeToolCallRow(
  runId: string,
  stepIndex: number,
  message: AssistantMessage,
  content = "",
): TranscriptRow {
  return { role: "assistant", content, responseData: asJsonValue({ run_id: runId, step_index: stepIndex, message }) };
}

/** The plain assistant row a finished turn's answer was committed as. */
export function makeAnswerRow(content: string): TranscriptRow {
  return { role: "assistant", content, responseData: null };
}

export function makeStep(stepIndex: number, result: StepResult | null): PersistedStep {
  return { stepIndex, toolName: "lookup_spot", input: {}, result };
}

export interface LoadedTurnParts {
  readonly transcript: TranscriptRow[];
  readonly steps?: PersistedStep[];
  readonly earlierSteps?: RunSteps[];
}

/** The turn `RUN_ID` resumes from, over the rows a case names. */
export function makeLoadedTurn(parts: LoadedTurnParts): LoadedTurn {
  return {
    runId: RUN_ID,
    sessionId: "session-1",
    deadlineAt: 0,
    transcript: parts.transcript,
    steps: parts.steps ?? [],
    earlierSteps: parts.earlierSteps ?? [],
    callerKeyed: false,
    selection: null,
  };
}
