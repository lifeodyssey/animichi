/**
 * A pi transcript with tool calls and their returns in it (card #1290).
 *
 * Compaction is a claim about what the model SEES, so its cases need the same
 * `AgentMessage[]` shape `seededMessages` rebuilds from Neon: an assistant
 * message issuing a call, the tool result answering it by id, and enough of
 * them that some are older than the retention window.
 */
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { AssistantMessage, ToolResultMessage } from "@earendil-works/pi-ai";
import { mimoModel } from "../../src/agent/session/turn-model.ts";

const NO_COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
const NO_USAGE = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: NO_COST };

/** One tool call and the return that answered it. */
export interface ScriptedExchange {
  readonly id: string;
  readonly toolName: string;
  readonly arguments: Record<string, unknown>;
  /** The tool's own JSON answer, as `outcomeToolResult` encodes it. */
  readonly outcome: unknown;
}

function assistantCall(exchange: ScriptedExchange): AssistantMessage {
  const model = mimoModel();
  return {
    role: "assistant",
    content: [{ type: "toolCall", id: exchange.id, name: exchange.toolName, arguments: exchange.arguments }],
    api: model.api, provider: model.provider, model: model.id,
    usage: NO_USAGE, stopReason: "toolUse", timestamp: 0,
  };
}

function toolReturn(exchange: ScriptedExchange): ToolResultMessage {
  return {
    role: "toolResult",
    toolCallId: exchange.id,
    toolName: exchange.toolName,
    content: [{ type: "text", text: JSON.stringify(exchange.outcome) }],
    details: null,
    isError: false,
    timestamp: 0,
  };
}

/** A user turn, its tool exchange, and nothing else — three messages. */
export function makeToolTurn(text: string, exchange: ScriptedExchange): AgentMessage[] {
  return [
    { role: "user", content: text, timestamp: 0 },
    assistantCall(exchange),
    toolReturn(exchange),
  ];
}

/** A `search_bangumi` outcome long enough to be worth summarising. */
export function makeLongSearchOutcome(title: string): unknown {
  return {
    outcome: "ok",
    result_ref: "search:12:1",
    row_count: 12,
    anime_title: title,
    partial: false,
    rows: Array.from({ length: 12 }, (_unused, index) => ({
      id: `point-${String(index)}`,
      name: `聖地スポット ${String(index)}`,
      lat: 36.1 + index,
      lng: 139.6 + index,
    })),
  };
}
