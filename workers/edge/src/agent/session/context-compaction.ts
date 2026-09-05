/**
 * The one dynamic compaction path left: a batch pass that fires only when a
 * session's context approaches the model's window (card #1378, spec §九 9.2).
 *
 * WHAT USED TO BE HERE, AND WHY IT IS GONE. This tier kept the newest
 * `KEEP_RECENT_MESSAGES = 8` messages untouched and summarised the older tool
 * returns — on EVERY model request, because that is when pi calls
 * `transformContext`. The window therefore slid inside a single turn: the same
 * tool result was raw on request 1 and a summary on request 3, so the prefix
 * bytes moved under the provider's prompt cache on every request. 李博杰《深入
 * 理解 AI Agent》ch.2 实验 2-3 names that pattern (滑动窗口对话历史) and the
 * cache chapter names the fix — a tool result's replacement string is frozen
 * when it first appears. It is frozen at WRITE time now
 * (`frozen-tool-return.ts`, `turn-step.ts`) and replayed by
 * `turn-transcript.ts`, so nothing here re-decides it.
 *
 * WHY A THRESHOLD RATHER THAN A PER-TURN PASS:「最好在上下文接近阈值时批量压缩，
 * 而不是每轮都压」(ch.2「压缩与 KV Cache：看似矛盾，实则互补」), because a
 * compaction invalidates the cache from its first edit onwards, so paying for
 * it rarely and in bulk is strictly cheaper than paying a little every turn.
 * 实验 2-10 策略六 is the shape ported: threshold trigger, one batch pass, and a
 * mark that stops a second pass from re-processing what the first already
 * shrank.
 *
 * IT IS NOT EXPECTED TO FIRE, and that is the point of writing the number down.
 * Measured with pi's own `estimateContextTokens` over the 3-turn transcript
 * this tier builds (pi-agent-core 0.84.4): `{tokens: 870, usageTokens: 0}` —
 * two orders of magnitude under the trigger. The pass exists so a session that
 * really does approach the window has an exit that is not a truncated prompt,
 * not because it is a daily path.
 */
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { ToolResultMessage } from "@earendil-works/pi-ai";
import { returnTextOf, TOOL_RETURN_MAX_CHARS } from "./frozen-tool-return.ts";
import { toolReturnSummary } from "./tool-return-summary.ts";

/** 80% of the 128k window the models this tier runs on carry. */
export const CONTEXT_COMPACTION_TRIGGER_TOKENS = 102_400;

/** Characters per token, the estimate pi's own `estimateContextTokens` uses.
 * The trigger only ever asks a yes/no question two orders of magnitude away
 * from the answer, so an estimate is what it needs. */
const CHARS_PER_TOKEN = 4;

/** The mark a batch-compacted return carries (实验 2-10 策略六's 防重复保护).
 * Without it a summary that is itself long — an ambiguous resolve with many
 * ordered candidate ids — would be summarised a second time and lose the very
 * ids the first pass kept verbatim. */
const COMPACTED_MARK = "[compacted] ";

function isToolResult(message: AgentMessage): message is ToolResultMessage {
  return "role" in message && message.role === "toolResult";
}

function estimatedTokens(messages: readonly AgentMessage[]): number {
  const chars = messages.reduce((total, message) => total + JSON.stringify(message).length, 0);
  return chars / CHARS_PER_TOKEN;
}

/** The same return with its text replaced, images untouched. */
function textReplaced(message: ToolResultMessage, text: string): ToolResultMessage {
  const kept = message.content.filter((part) => part.type !== "text");
  return { ...message, content: [{ type: "text", text }, ...kept] };
}

/** One return, shrunk unless it is short already or this pass has been here. */
function batched(message: AgentMessage): AgentMessage {
  if (!isToolResult(message)) return message;
  const text = returnTextOf(message.content);
  if (text.startsWith(COMPACTED_MARK) || text.length <= TOOL_RETURN_MAX_CHARS) return message;
  return textReplaced(message, COMPACTED_MARK + toolReturnSummary(message.toolName, text));
}

/** Every unmarked long return shrunk in one pass, or the context untouched
 * while it is still under the trigger. */
export function batchCompacted(messages: readonly AgentMessage[]): AgentMessage[] {
  if (estimatedTokens(messages) <= CONTEXT_COMPACTION_TRIGGER_TOKENS) return [...messages];
  return messages.map(batched);
}

/**
 * The `transformContext` one turn's agent runs with (`turn-agent.ts`).
 *
 * pi calls it on the way into every model request, which is why it must be
 * IDEMPOTENT and free: below the trigger it hands the context straight back,
 * and above it the marked pass answers the same bytes however often it runs.
 */
export function contextCompaction(): (messages: AgentMessage[]) => Promise<AgentMessage[]> {
  return (messages) => Promise.resolve(batchCompacted(messages));
}
