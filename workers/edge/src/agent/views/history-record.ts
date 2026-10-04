import { ChatResponseDataPart } from "@animichi/contract";
import type { SessionHistoryMessage, SessionModelCall, SessionToolResult, SessionUsage } from "@animichi/contract/session-history-contract";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { Entry, UsageRow } from "@earendil-works/pi-agent-core/harness/session";
import type { Usage } from "@earendil-works/pi-ai";
import { readSelectionEntry } from "@animichi/agent/selection-entry";
import type { SecretScrub } from "../egress/secret-scrub.ts";
import { domainPayload, publicValue } from "./public-content.ts";

type ProseMessage = Extract<AgentMessage, { role: "user" | "assistant" }>;
type ToolResultMessage = Extract<AgentMessage, { role: "toolResult" }>;

export interface ProjectedMessage { readonly entry: Entry; readonly message: SessionHistoryMessage }
export interface HistoryRecord {
  readonly messages: ProjectedMessage[];
  readonly toolResults: SessionToolResult[];
  readonly modelCalls: SessionModelCall[];
}

/**
 * The complete per-turn record of ticket 4 (#1996, #2004): the transcript plus
 * every tool result and every model call, projected read-only from the entries
 * and usage rows a caller already read. Every filter here is load-bearing —
 * thinking content, compaction and non-selection custom entries, other lanes,
 * and credentials never cross it.
 */
export function projectHistory(entries: readonly Entry[], usageRows: readonly UsageRow[], operations: ReadonlyMap<string, string>, scrub: SecretScrub): HistoryRecord {
  return { messages: projectMessages(entries, operations, scrub), toolResults: projectToolResults(entries, scrub), modelCalls: projectModelCalls(entries, usageRows) };
}

function projectMessages(entries: readonly Entry[], operations: ReadonlyMap<string, string>, scrub: SecretScrub): ProjectedMessage[] {
  return entries.flatMap((entry) => visibleMessages(entry, scrub).map((message) => ({ entry, message: withOperation(message, entry, operations) })));
}

function withOperation(message: SessionHistoryMessage, entry: Entry, operations: ReadonlyMap<string, string>): SessionHistoryMessage {
  const operationId = operations.get(entry.id);
  return operationId === undefined ? message : { ...message, operation_id: operationId };
}

/** Only messages and the executed selection custom entry project; compaction, branch summaries and every other custom entry do not. */
function visibleMessages(entry: Entry, scrub: SecretScrub): SessionHistoryMessage[] {
  if (entry.type === "custom") return selectionMessage(entry, scrub);
  if (entry.type !== "message") return [];
  const message = entry.message;
  if (message.role === "toolResult") return respondAnswer(message, entry.timestamp, scrub);
  if (message.role !== "user" && message.role !== "assistant") return [];
  return proseMessage(message, entry.timestamp, scrub);
}

function selectionMessage(entry: Entry, scrub: SecretScrub): SessionHistoryMessage[] {
  try {
    const selected = readSelectionEntry(entry);
    return selected ? publicAnswer(selected.result.response, entry.timestamp, scrub) : [];
  } catch { return []; }
}

function respondAnswer(message: ToolResultMessage, timestamp: number, scrub: SecretScrub): SessionHistoryMessage[] {
  return message.toolName === "respond" && !message.isError ? publicAnswer(message.details, timestamp, scrub) : [];
}

function publicAnswer(details: unknown, timestamp: number, scrub: SecretScrub): SessionHistoryMessage[] {
  const parsed = ChatResponseDataPart.safeParse(domainPayload(details));
  if (!parsed.success) return [];
  return [{ role: "assistant", content: scrub.text(parsed.data.message ?? ""),
    response_data: { intent: parsed.data.intent, success: parsed.data.success ?? true }, created_at: new Date(timestamp).toISOString() }];
}

function proseMessage(message: ProseMessage, timestamp: number, scrub: SecretScrub): SessionHistoryMessage[] {
  const calls = message.role === "assistant" ? message.content.filter((part) => part.type === "toolCall") : [];
  const text = scrub.text(visibleText(message));
  const content = calls.length ? JSON.stringify({ content: text, tool_calls: calls.map((call) => ({ id: call.id, type: "function", function: { name: call.name, arguments: scrub.text(JSON.stringify(call.arguments)) } })) }) : text;
  return content ? [{ role: message.role, content, created_at: new Date(timestamp).toISOString(), response_data: null }] : [];
}

/** Text parts only: a thinking part is filtered here, not merely left out of a rendered string. */
function visibleText(message: ProseMessage): string {
  if (typeof message.content === "string") return message.content;
  return message.content.flatMap((part) => part.type === "text" ? [part.text] : []).join("");
}

function projectToolResults(entries: readonly Entry[], scrub: SecretScrub): SessionToolResult[] {
  return entries.flatMap((entry) => entry.type === "message" && entry.message.role === "toolResult" ? [toolResult(entry.message, scrub)] : []);
}

function toolResult(message: ToolResultMessage, scrub: SecretScrub): SessionToolResult {
  return { tool_call_id: message.toolCallId, tool_name: message.toolName, is_error: message.isError, result: JSON.stringify(publicValue(message.details, scrub)) };
}

/** A usage row whose entry is not on this visible main-branch page belongs to another lane or a filtered record. */
function projectModelCalls(entries: readonly Entry[], usageRows: readonly UsageRow[]): SessionModelCall[] {
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  return usageRows.flatMap((row) => {
    const entry = row.entryId === undefined ? undefined : byId.get(row.entryId);
    if (entry === undefined) return [];
    const identity = modelIdentity(entry);
    return identity === undefined ? [] : [{ provider: identity.provider, model: identity.model, usage: publicUsage(row.usage) }];
  });
}

function modelIdentity(entry: Entry): { provider: string; model: string } | undefined {
  if (entry.type !== "message") return undefined;
  if (entry.message.role === "assistant") return { provider: entry.message.provider, model: entry.message.model };
  if (entry.message.role !== "toolResult" || entry.message.toolName !== "translate_anime_title") return undefined;
  return toolModelIdentity(entry.message.details);
}

/** The catalog-miss fallback records its provider and model beside the payer its usage row hangs on. */
function toolModelIdentity(details: unknown): { provider: string; model: string } | undefined {
  if (details === null || typeof details !== "object") return undefined;
  const { provider, model } = details as { provider?: unknown; model?: unknown };
  return typeof provider === "string" && typeof model === "string" ? { provider, model } : undefined;
}

function publicUsage(usage: Usage): SessionUsage {
  return { input: usage.input, output: usage.output, cache_read: usage.cacheRead, cache_write: usage.cacheWrite, total_tokens: usage.totalTokens,
    cost: { input: usage.cost.input, output: usage.cost.output, cache_read: usage.cost.cacheRead, cache_write: usage.cost.cacheWrite, total: usage.cost.total } };
}
