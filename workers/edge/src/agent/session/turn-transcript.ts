/**
 * The transcript a retried alarm resumes from (card #1252; spec
 * `docs/specs/2026-09-01-agent-ts-rewrite-spec.md` Appendix C's implementation
 * requirement: "assistant 的 tool-call 消息必须与 `run_steps` 一起持久化并从转录
 * 重放——这是 W1-3 的实现条件，不是优化项").
 *
 * WHY IT IS A REBUILD AND NOT A REPLAY OF EVENTS: a retried alarm must not ask
 * the model to re-derive the tool calls it already made, because a second
 * derivation could pick different calls and every `step_index` after it would
 * name something else. Seeding pi's transcript with the assistant tool-call
 * messages and their persisted results makes the loop CONTINUE instead, so the
 * next new call is the (n+1)-th by construction.
 *
 * A tool-call row carries its own `run_id` and `step_index` in
 * `messages.response_data`, so the pairing is explicit rather than positional:
 * only THIS run's rows are paired against the `run_steps` rows this alarm
 * loaded, and an EARLIER turn's tool-call row degrades to its plain text (its
 * steps live under another run id and were never loaded). Without that marker a
 * session's second turn would try to answer the first turn's calls from an
 * empty step list and truncate the whole history.
 *
 * The trailing truncation is the crash branch. One assistant message may carry
 * several tool calls, and a crash between two of them leaves the message with an
 * unanswered call; pi's `continue()` requires the transcript to end on a user or
 * tool-result message, and a model asked to answer an unanswered call would
 * invent one. Dropping that message returns the loop to the last complete
 * result — `TurnStep` still replays the steps that did land, so nothing runs
 * twice.
 */
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type {
  Api,
  AssistantMessage,
  Model,
  ToolCall,
  ToolResultMessage,
} from "@earendil-works/pi-ai";
import { isJsonRecord } from "../json-record.ts";
import type {
  LoadedTurn,
  PersistedStep,
  StepResult,
  ToolCallEnvelope,
  TranscriptRow,
} from "./turn-store.ts";

const ZERO_COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
const ZERO_USAGE = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: ZERO_COST };

/** The envelope a row carries for THIS run, or null for anything else. */
export function toolCallEnvelopeOf(row: TranscriptRow, runId: string): ToolCallEnvelope | null {
  const held = row.responseData;
  if (!isJsonRecord(held) || held.run_id !== runId) return null;
  const ok = typeof held.step_index === "number" && isJsonRecord(held.message);
  return ok ? (held as unknown as ToolCallEnvelope) : null;
}

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

function toolResultFor(call: ToolCall, result: StepResult): ToolResultMessage {
  return {
    role: "toolResult",
    toolCallId: call.id,
    toolName: call.name,
    content: result.content,
    details: result.details,
    isError: false,
    timestamp: 0,
  };
}

/** Every call of one assistant turn answered, or null when one has no result. */
function answersFor(
  envelope: ToolCallEnvelope,
  settled: Map<number, StepResult>,
): ToolResultMessage[] | null {
  const answers = toolCallsOf(envelope.message).map((call, offset) => {
    const result = settled.get(envelope.step_index + offset);
    return result === undefined ? null : toolResultFor(call, result);
  });
  return answers.every((answer) => answer !== null) ? answers : null;
}

function settledResults(steps: readonly PersistedStep[]): Map<number, StepResult> {
  const settled = new Map<number, StepResult>();
  for (const step of steps) if (step.result !== null) settled.set(step.stepIndex, step.result);
  return settled;
}

/** The messages one row contributes, or null when the transcript ends here. */
function messagesForRow(
  row: TranscriptRow,
  turn: LoadedTurn,
  settled: Map<number, StepResult>,
  model: Model<Api>,
): AgentMessage[] | null {
  if (row.role === "user") return [{ role: "user", content: row.content, timestamp: 0 }];
  const envelope = toolCallEnvelopeOf(row, turn.runId);
  if (envelope === null) return row.content === "" ? [] : [plainAssistant(row.content, model)];
  const answers = answersFor(envelope, settled);
  return answers === null ? null : [envelope.message, ...answers];
}

/**
 * The pi transcript this run resumes from: the session's stored messages, with
 * every persisted tool call of THIS run answered by its `run_steps` result.
 */
export function seededMessages(turn: LoadedTurn, model: Model<Api>): AgentMessage[] {
  const settled = settledResults(turn.steps);
  const seeded: AgentMessage[] = [];
  for (const row of turn.transcript) {
    const contributed = messagesForRow(row, turn, settled, model);
    if (contributed === null) return seeded;
    seeded.push(...contributed);
  }
  return seeded;
}
