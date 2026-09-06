/**
 * The turn one frozen prefix is written AS (E-1 #1380, spec §十 10.1).
 *
 * Four projections of one value, and each one lands on a seam the product
 * already has: the intake's `TurnSubmission`, the store's `SettledStep`, the
 * store's `SucceededTurnRecord`, and the session's `SessionEnvelope`. Nothing
 * here writes anything — `prefix-seeding.ts` does, through the very ports a
 * real turn is written through — so what this module is answerable for is only
 * that a seeded turn is INDISTINGUISHABLE from a turn that ran.
 *
 * THE ASSISTANT TOOL-CALL MESSAGE IS THE POINT. Appendix C's implementation
 * requirement is that the message and its `run_steps` row are persisted
 * together and replayed from the transcript; `turn-transcript.ts` answers each
 * stored call from the steps of the run NAMED IN IT and drops an earlier run's
 * message whose calls are not all answered. So a prefix that wrote the message
 * without the settled row would be a prefix the model never sees — it would
 * re-derive the call, which is exactly what a trajectory prefix exists to stop.
 *
 * `api` / `provider` / `model` on that message name the seeding rather than a
 * provider, because no provider produced it. They are replay metadata pi does
 * not branch on (`turn-transcript.ts` pushes the stored message through
 * unchanged), and naming them honestly is cheaper than borrowing a model id
 * that never ran.
 */
import type { AssistantMessage, ToolCall } from "@earendil-works/pi-ai";
import type { RunPayer } from "../../db/schema.ts";
import type { TurnSubmission } from "../intake/turn-intake.ts";
import type { TurnUsage, UsagePrices } from "../settlement/turn-settlement.ts";
import { frozenSummaryOf } from "./frozen-tool-return.ts";
import { SessionEnvelope } from "./session-envelope.ts";
import type { SettledStep, SucceededTurnRecord } from "./turn-store.ts";
import type { TrajectoryPrefix } from "./trajectory-prefix.ts";

/** The `messages.client_message_id` a case's prefix is deduped on — the whole
 * idempotency mechanism, borrowed from the intake rather than invented. */
export function prefixMessageKey(caseId: string): string {
  return `prefix:${caseId}`;
}

/** A seeded turn spends no tokens: it made no provider request. */
const NO_USAGE: TurnUsage = { requests: 0, inputTokens: 0, outputTokens: 0 };

/** What the replay metadata of a seeded assistant message says it is. */
const SEEDED_ORIGIN = "trajectory-prefix";

const ZERO_COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
const ZERO_USAGE = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: ZERO_COST };

/** The prefix's only step: index 0 of its only run. */
export const PREFIX_STEP_INDEX = 0;

/** The submission the intake commits: one user message, one `running` run, on
 * the caller's own identity — which is what makes the session the caller's. */
export function prefixSubmission(
  prefix: TrajectoryPrefix, sessionId: string, identityId: string, payer: RunPayer,
): TurnSubmission {
  return {
    sessionId,
    identityId,
    payer,
    clientMessageId: prefixMessageKey(prefix.caseId),
    text: prefix.userText,
    selection: null,
  };
}

/** The call the seeded assistant turn issued, as pi models one. */
function prefixCall(prefix: TrajectoryPrefix): ToolCall {
  return {
    type: "toolCall",
    id: `${prefix.toolCall.toolName}-${crypto.randomUUID()}`,
    name: prefix.toolCall.toolName,
    arguments: prefix.toolCall.params,
  };
}

/** The assistant message that issued it, in the shape `messages.response_data`
 * stores and `toolCallEnvelopeOf` reads back. */
function prefixMessage(call: ToolCall): AssistantMessage {
  return {
    role: "assistant",
    content: [call],
    api: SEEDED_ORIGIN,
    provider: SEEDED_ORIGIN,
    model: SEEDED_ORIGIN,
    usage: ZERO_USAGE,
    stopReason: "toolUse",
    timestamp: 0,
  };
}

/**
 * The one settled step, with the message that opened it.
 *
 * The short form is frozen here by the SAME decision the live path takes
 * (`frozen-tool-return.ts`, #1378) rather than by a rule of its own: a later
 * turn replays an earlier run's result as `result.summary`, so a prefix that
 * decided its summary differently would put different bytes in the context
 * than the turn it is standing in for.
 */
export function prefixStep(prefix: TrajectoryPrefix, runId: string): SettledStep {
  const call = prefixCall(prefix);
  const content = [{ type: "text" as const, text: prefix.toolCall.resultText }];
  const summary = frozenSummaryOf(prefix.toolCall.toolName, content);
  return {
    stepIndex: PREFIX_STEP_INDEX,
    toolName: prefix.toolCall.toolName,
    input: prefix.toolCall.params,
    result: { content, details: prefix.toolCall.resultDetails, minted: [], summary },
    toolCallMessage: { run_id: runId, step_index: PREFIX_STEP_INDEX, message: prefixMessage(call) },
  };
}

/**
 * The answer the seeded turn ended on, settled as `succeeded`.
 *
 * TERMINAL, NOT `running`, and that is a constraint rather than a preference:
 * `runs_one_running_per_session` is a partial unique index, so a prefix run
 * left running would make the very turn under measurement a 409.
 *
 * `responseData` is null. That column carries the projected `data-response`
 * part a real turn's `respond` call produced (`turn-answer-part.ts`), and this
 * turn called nothing: publishing a fabricated intent would put a value the
 * retrieval surface reads as the agent's own on a row no agent wrote.
 */
export function prefixAnswer(
  prefix: TrajectoryPrefix, runId: string, sessionId: string, prices: UsagePrices,
): SucceededTurnRecord {
  return {
    runId,
    sessionId,
    answer: prefix.assistantText,
    responseData: null,
    usage: NO_USAGE,
    supplemental: NO_USAGE,
    prices,
  };
}

/**
 * The state the seeded turn left behind.
 *
 * The clarification's id is also the session's revision — `SessionEnvelope`'s
 * constructor takes the greater of the two — so the next question a real turn
 * asks is strictly greater than this one, and a reply naming this id can never
 * validate against the question that replaces it (`session-envelope.ts`).
 */
export function prefixEnvelope(prefix: TrajectoryPrefix): SessionEnvelope {
  return new SessionEnvelope(prefix.pendingClarification, prefix.currentAnime);
}
