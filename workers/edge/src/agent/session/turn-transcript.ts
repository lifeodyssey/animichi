/**
 * The transcript a turn resumes from (card #1252, widened to the whole session
 * by #1377; spec `docs/specs/2026-09-01-agent-ts-rewrite-spec.md` Appendix C's
 * implementation requirement: "assistant 的 tool-call 消息必须与 `run_steps`
 * 一起持久化并从转录重放——这是 W1-3 的实现条件，不是优化项", and §九 9.1's
 * decision that EVERY turn's calls come back structured).
 *
 * WHY IT IS A REBUILD AND NOT A REPLAY OF EVENTS: a retried alarm must not ask
 * the model to re-derive the tool calls it already made, because a second
 * derivation could pick different calls and every `step_index` after it would
 * name something else. Seeding pi's transcript with the assistant tool-call
 * messages and their persisted results makes the loop CONTINUE instead, so the
 * next new call is the (n+1)-th by construction.
 *
 * WHY EVERY TURN AND NOT JUST THIS ONE (spec §九 9.1, 李博杰《深入理解 AI
 * Agent》ch.2 实验 2-3): degrading an earlier turn's tool-call row to its plain
 * text stacked two of that experiment's named anti-patterns. Sliding-window
 * history — the results of turn 1 were gone by turn 3, so the model re-called
 * the tool it had already been answered. Text formatting — structured
 * role-content messages collapsed into prose, which the model has to spend
 * attention re-parsing into calls and answers. Both turns of the session now
 * arrive as `assistant` + `toolResult` messages, the shape the model was
 * trained on.
 *
 * AN EARLIER TURN'S RESULT COMES BACK AS ITS FROZEN SUMMARY, which is what
 * keeps "every turn" bounded (spec §九 9.1 → 9.2). The summary was decided when
 * the step was written and is stored on the row, so this rebuild reads a string
 * rather than deciding one: two alarms over the same session produce the same
 * bytes. THIS run's own settled steps are replayed whole — a retried alarm
 * resumes the attempt that saw them whole (`frozen-tool-return.ts`).
 *
 * A tool-call row carries its own `run_id` and `step_index` in
 * `messages.response_data`, so the pairing stays explicit rather than
 * positional: each row is answered from the steps of the run NAMED IN IT —
 * this run's rows from the `run_steps` this alarm loaded, an earlier run's rows
 * from that run's own steps (`LoadedTurn.earlierSteps`). Two runs that both
 * numbered a call `step_index: 0` therefore cannot answer each other's.
 *
 * The unanswered call is the crash branch, and it reads differently by run. One
 * assistant message may carry several tool calls, and a crash between two of
 * them leaves the message with an unanswered call; a model asked to answer one
 * would invent a result, so the message is never seeded half-answered. For THIS
 * run the whole rebuild stops there — pi's `continue()` requires the transcript
 * to end on a user or tool-result message, and `TurnStep` replays the steps
 * under the dropped message in place, so nothing runs twice. For an EARLIER run
 * — a turn that crashed and was retried or abandoned — the unanswered message
 * is left out and the walk carries on, because the turns AFTER it are history
 * the model still needs and dropping them would be the sliding window again.
 *
 * `settledSteps` counts only THIS run's seeded answers: it is where
 * `StepSequence` starts numbering, so an earlier run's results counted into it
 * would make this run's first new call claim an index another step already holds.
 *
 * REPLAYING A TURN REPLAYS ITS REFS, AND A REF NOW NAMES ITS RUN. The results
 * seeded here carry the `result_ref` handles the model was given, and refs are
 * a per-RUN registry — only this run's mints are put back (`rehydrateRefs`).
 * So the mint carries its issuing run (`turn-catalog-session.ts`): a foreign
 * handle cannot collide with one of this run's and always lands on
 * `stale_ref`, instead of silently resolving to THIS run's rows. Rehydrating
 * earlier runs' mints — making those handles live again — is a separate
 * decision and is deliberately NOT taken here.
 */
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type {
  Api,
  AssistantMessage,
  Model,
  ToolCall,
  ToolResultMessage,
} from "@earendil-works/pi-ai";
import { frozenReturn, verbatimReturn, type ReplayedContent } from "./frozen-tool-return.ts";
import {
  toolCallEnvelopeOf,
  type LoadedTurn,
  type PersistedStep,
  type StepResult,
  type ToolCallEnvelope,
  type TranscriptRow,
} from "./turn-store.ts";

const ZERO_COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
const ZERO_USAGE = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: ZERO_COST };
const NO_RESULTS: ReadonlyMap<number, StepResult> = new Map();

function toolCallsOf(message: AssistantMessage): ToolCall[] {
  return message.content.filter((part): part is ToolCall => part.type === "toolCall");
}

/** A historical assistant turn, re-clothed for the model that is running now. */
function plainAssistant(text: string, model: Model<Api>): AssistantMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: ZERO_USAGE,
    stopReason: "stop",
    timestamp: 0,
  };
}

/** An assistant row that issued no calls: its text, or nothing when it is empty. */
function textOnly(text: string, model: Model<Api>): AgentMessage[] {
  return text === "" ? [] : [plainAssistant(text, model)];
}

function toolResultFor(call: ToolCall, result: StepResult, shown: ReplayedContent): ToolResultMessage {
  return {
    role: "toolResult",
    toolCallId: call.id,
    toolName: call.name,
    content: shown(result),
    details: result.details,
    isError: false,
    timestamp: 0,
  };
}

/** Every call of one assistant turn answered, or null when one has no result. */
function answersFor(
  envelope: ToolCallEnvelope,
  settled: ReadonlyMap<number, StepResult>,
  shown: ReplayedContent,
): ToolResultMessage[] | null {
  const answers = toolCallsOf(envelope.message).map((call, offset) => {
    const result = settled.get(envelope.step_index + offset);
    return result === undefined ? null : toolResultFor(call, result, shown);
  });
  return answers.every((answer) => answer !== null) ? answers : null;
}

function settledResults(steps: readonly PersistedStep[]): Map<number, StepResult> {
  const settled = new Map<number, StepResult>();
  for (const step of steps) if (step.result !== null) settled.set(step.stepIndex, step.result);
  return settled;
}

/**
 * Every settled step of the session, addressed the way a stored tool-call row
 * addresses one: by the run that issued the call, then by `step_index`.
 */
class SessionResults {
  readonly #byRun = new Map<string, Map<number, StepResult>>();

  constructor(turn: LoadedTurn) {
    this.#byRun.set(turn.runId, settledResults(turn.steps));
    for (const run of turn.earlierSteps) this.#byRun.set(run.runId, settledResults(run.steps));
  }

  /** What that run settled — empty for a run whose steps were never written. */
  of(runId: string): ReadonlyMap<number, StepResult> {
    return this.#byRun.get(runId) ?? NO_RESULTS;
  }
}

/**
 * The transcript this run resumes from, and how far into its own steps it
 * already reaches.
 *
 * The count is what the step counter starts at (`turn-step-sequence.ts`,
 * #1279): a seeded tool result is a step the model will NOT ask for again, so
 * the next call it makes is the (n+1)-th of the run rather than the first. It
 * is counted off the seeded answers of THIS run instead of off `turn.steps`
 * because the two differ exactly where it matters — a trailing assistant
 * message whose calls are not all answered is dropped, and the steps under it
 * are then replayed in place by the calls the model re-derives.
 */
export interface ResumedTranscript {
  readonly messages: AgentMessage[];
  /** How many of THIS run's settled steps the messages already answer. */
  readonly settledSteps: number;
}

/**
 * The walk that rebuilds one run's transcript out of the session's rows, and
 * what it counted on the way: only this run's answers move the step counter.
 */
class TranscriptRebuild {
  readonly #turn: LoadedTurn;
  readonly #model: Model<Api>;
  readonly #results: SessionResults;
  readonly #messages: AgentMessage[] = [];
  #settledSteps = 0;

  constructor(turn: LoadedTurn, model: Model<Api>) {
    this.#turn = turn;
    this.#model = model;
    this.#results = new SessionResults(turn);
  }

  /** The rebuild, walked until one of THIS run's calls has no answer. */
  resumed(): ResumedTranscript {
    for (const row of this.#turn.transcript) if (!this.#take(row)) break;
    return { messages: this.#messages, settledSteps: this.#settledSteps };
  }

  /** Take one row in; false ends the walk. */
  #take(row: TranscriptRow): boolean {
    if (row.role === "user") return this.#push([{ role: "user", content: row.content, timestamp: 0 }]);
    const envelope = toolCallEnvelopeOf(row);
    if (envelope === null) return this.#push(textOnly(row.content, this.#model));
    return this.#takeCalls(envelope);
  }

  /** A tool-call turn, answered by the run that issued it — or dropped: this
   * run's unanswered call ends the walk, an earlier run's is skipped. An
   * earlier turn's answers are shown as the summary frozen when they were
   * written; this run's own are shown whole (#1378). */
  #takeCalls(envelope: ToolCallEnvelope): boolean {
    const own = envelope.run_id === this.#turn.runId;
    const shown = own ? verbatimReturn : frozenReturn;
    const answers = answersFor(envelope, this.#results.of(envelope.run_id), shown);
    if (answers === null) return !own;
    if (own) this.#settledSteps += answers.length;
    return this.#push([envelope.message, ...answers]);
  }

  #push(messages: readonly AgentMessage[]): true {
    this.#messages.push(...messages);
    return true;
  }
}

/** The rebuild, with the step count the loop resumes at. */
export function resumedTranscript(turn: LoadedTurn, model: Model<Api>): ResumedTranscript {
  return new TranscriptRebuild(turn, model).resumed();
}
