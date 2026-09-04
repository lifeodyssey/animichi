/**
 * What the model actually sees of this session's history (card #1290, spec §一
 * compaction/memory parity) — port of `apps/agent`'s
 * `agents/history_compaction.py::CompactToolReturns`.
 *
 * The newest `KEEP_RECENT_MESSAGES` messages go through untouched; older tool
 * returns longer than `TOOL_RETURN_MAX_CHARS` are replaced by their
 * deterministic summary (`tool-return-summary.ts`), and the literal entity the
 * shrunken call carried is rescued into the retained-entity ledger BEFORE it
 * goes. It shapes the CONTEXT only: `messages` and `run_steps` in Neon are
 * never rewritten (spec §三), so the raw history is replayed and re-compacted
 * on every alarm — which is why every write it makes is idempotent.
 *
 * HAND-ROLLED `transformContext`, NOT pi's NATIVE COMPACTION. Measured against
 * the repo's provider double on a 3-turn transcript with tool returns
 * (pi-agent-core 0.84.4, `prepareCompaction` + `compact`):
 *
 *   DEFAULT_COMPACTION_SETTINGS = {enabled:true, reserveTokens:16384, keepRecentTokens:20000}
 *   raw = 12 messages / 5230 chars; estimateContextTokens = {tokens:50, lastUsageIndex:11}
 *   shouldCompact(50, window 128000) = false
 *   forced with {reserveTokens:10, keepRecentTokens:20}:
 *     prepareCompaction -> {messagesToSummarize:8, turnPrefixMessages:3, retainedTail:1, isSplitTurn:true}
 *     compact() round 1 -> summary "\n\n---\n\n**Turn Context (split turn):**\n\nHyouka fans go to Takayama."
 *     compact() round 2 -> summary "Hyouka fans go to Takayama.\n\n---\n\n**Turn Context (split turn):**\n\nHyouka fans go to Takayama."
 *   and on the transcript THIS tier builds (`resumedTranscript` re-clothes history
 *   with zero usage): estimateContextTokens = {tokens:870, usageTokens:0} -> shouldCompact = false.
 *
 * Four things that output says, each of which rules the native path out here:
 * 1. it never fires at our scale — the trigger is a token estimate against a
 *    128k window less a 16k reserve, so a whole pilgrimage session sits far
 *    under it while its tool returns are exactly what we need shrunk;
 * 2. what it produces is MODEL-WRITTEN prose plus a retained tail, so the
 *    ordered candidate ids an ordinal follow-up resolves against survive only
 *    if a model chooses to copy them;
 * 3. it is not a fixpoint — the same input compacted twice gave two different
 *    summaries, and this tier re-compacts the same raw history every turn;
 * 4. it consumes a provider call per compaction, on the run's own budget, and
 *    it reads session `Entry[]` from pi's own session log, which this tier does
 *    not keep — the transcript is rebuilt from Neon each alarm.
 * Python's tiering is deterministic, free and testable, so it is what is ported.
 * pi's native `SummarizingCompaction` tier was the SECOND tier there too, and
 * is deliberately not ported: the first tier is the one that pays for itself.
 */
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { AssistantMessage, ToolCall, ToolResultMessage } from "@earendil-works/pi-ai";
import { isJsonRecord } from "../json-record.ts";
import type { RetainedEntityLedger } from "../memory/retained-entity-ledger.ts";
import type { TurnMemory } from "../memory/session-memory.ts";
import { toolReturnSummary } from "./tool-return-summary.ts";

/** How many of the newest messages are never touched. */
export const KEEP_RECENT_MESSAGES = 8;

/** The length an older tool return has to exceed before it is summarised. */
export const TOOL_RETURN_MAX_CHARS = 200;

/**
 * The tool arguments that carry a literal, user-supplied entity worth rescuing
 * verbatim — an anime title and a place name, keyed by the argument's own name.
 */
const ENTITY_ARGUMENT: Readonly<Record<string, string>> = {
  resolve_anime: "title",
  search_nearby: "location",
};

function isAssistant(message: AgentMessage): message is AssistantMessage {
  return "role" in message && message.role === "assistant";
}

function isToolResult(message: AgentMessage): message is ToolResultMessage {
  return "role" in message && message.role === "toolResult";
}

function isToolCall(part: AssistantMessage["content"][number]): part is ToolCall {
  return part.type === "toolCall";
}

/**
 * Each tool call's own arguments, by call id.
 *
 * A tool RESULT carries the answer, never the question, so the entity the user
 * typed is only readable off the assistant message that issued the call.
 */
function callArgumentsById(messages: readonly AgentMessage[]): Map<string, unknown> {
  const calls = messages.filter(isAssistant).flatMap((message) => message.content.filter(isToolCall));
  return new Map(calls.map((call) => [call.id, call.arguments]));
}

/** The literal entity this call carried, if its tool has one at all. */
function entityIn(toolName: string, args: unknown): string | null {
  const field = ENTITY_ARGUMENT[toolName];
  if (field === undefined || !isJsonRecord(args)) return null;
  const value = args[field];
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

/** What the tool answered, as the one string both the cap and the summary read. */
function returnText(message: ToolResultMessage): string {
  return message.content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("");
}

/**
 * The same return with its text replaced by the summary, images untouched.
 *
 * `details` is deliberately left as it was: pi's OpenAI-completions adapter
 * puts only `content`'s text on the wire (`dist/api/openai-completions.js`
 * builds the tool message from `toolMsg.content` alone), so `details` is a
 * local sidecar this tier reads for its own frames and rows. Shrinking it would
 * save the model nothing and cost the server the outcome it answers from.
 */
function summarised(message: ToolResultMessage, summary: string): ToolResultMessage {
  const kept = message.content.filter((part) => part.type !== "text");
  return { ...message, content: [{ type: "text", text: summary }, ...kept] };
}

/**
 * Rescue the call's entity before the return that carried it is shrunk.
 *
 * A value that already equals the session's resolved title is skipped: it is
 * carried unabridged by `currentAnime` and by the candidate summary while it is
 * still ambiguous, so retaining it here would spend the same prompt budget
 * twice (Python's `_retain_entity`).
 */
function retaining(
  ledger: RetainedEntityLedger, message: ToolResultMessage, args: unknown, resolvedTitle: string | null,
): RetainedEntityLedger {
  const value = entityIn(message.toolName, args);
  if (value === null || value === resolvedTitle) return ledger;
  return ledger.record(message.toolName, value);
}

/**
 * One pass over one transcript: it carries the ledger the rescued entities land
 * in, so shrinking a message and recording what it was about stay one step.
 */
class ContextShaping {
  retained: RetainedEntityLedger;
  readonly #resolvedTitle: string | null;
  readonly #args: Map<string, unknown>;

  constructor(retained: RetainedEntityLedger, resolvedTitle: string | null, args: Map<string, unknown>) {
    this.retained = retained;
    this.#resolvedTitle = resolvedTitle;
    this.#args = args;
  }

  /** One OLD message: its entity rescued, and its long return summarised. */
  shrink(message: AgentMessage): AgentMessage {
    if (!isToolResult(message)) return message;
    const args = this.#args.get(message.toolCallId);
    this.retained = retaining(this.retained, message, args, this.#resolvedTitle);
    const text = returnText(message);
    if (text.length <= TOOL_RETURN_MAX_CHARS) return message;
    return summarised(message, toolReturnSummary(message.toolName, text));
  }
}

/** The context the model is handed, and the entities rescued building it. */
export interface CompactedContext {
  readonly messages: AgentMessage[];
  readonly retained: RetainedEntityLedger;
}

/**
 * Shrink the old tool returns of one transcript. Pure: the same messages and
 * the same ledger in always give the same context and ledger out, which is what
 * makes re-running it over the replayed raw history a fixpoint.
 */
export function compactToolReturns(
  messages: readonly AgentMessage[],
  retained: RetainedEntityLedger,
  resolvedTitle: string | null,
): CompactedContext {
  const cutoff = Math.max(0, messages.length - KEEP_RECENT_MESSAGES);
  const shaping = new ContextShaping(retained, resolvedTitle, callArgumentsById(messages));
  const shaped = messages.map((message, index) =>
    index < cutoff ? shaping.shrink(message) : message);
  return { messages: shaped, retained: shaping.retained };
}

/**
 * The `transformContext` one turn's agent runs with (`turn-agent.ts`).
 *
 * The rescued entities are published to the session on the way past, which is
 * the one impure step and belongs here rather than in the loop: pi calls this
 * per model request, so a turn that makes three requests re-compacts the same
 * history three times, and only a ledger that dedups makes that unobservable.
 */
export function contextCompaction(turn: TurnMemory): (messages: AgentMessage[]) => Promise<AgentMessage[]> {
  return (messages) => {
    const { memory, resolvedTitle } = turn;
    const compacted = compactToolReturns(messages, memory.retainedEntities, resolvedTitle);
    turn.remember({ ...memory, retainedEntities: compacted.retained });
    return Promise.resolve(compacted.messages);
  };
}
