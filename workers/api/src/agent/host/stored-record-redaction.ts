import type { NewEntry } from "@earendil-works/pi-agent-core/harness/session";
import type { KeyLiterals } from "../egress/key-literals.ts";

/**
 * Redacts the bound key literals from the content of a stored pi record and keeps its identity fields as committed,
 * because pi looks identity up and compares it. Every field a record kind does not name as identity is content.
 */
type Redaction = (value: unknown, literals: KeyLiterals) => unknown;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const content: Redaction = (value, literals) => literals.value(value);
const NO_RULES = new Map<string, Redaction>();

/** `kept` fields stay, a field with a rule follows it, and every other field is content. */
function redactFields(value: unknown, literals: KeyLiterals, kept: ReadonlySet<string>, rules: ReadonlyMap<string, Redaction>): unknown {
  if (!isRecord(value)) return literals.value(value);
  return Object.fromEntries(Object.entries(value).map(([key, field]) => [key, kept.has(key) ? field : (rules.get(key) ?? content)(field, literals)]));
}

/** The fields that have a rule, each redacted by it. */
function redactNamed(value: unknown, literals: KeyLiterals, rules: ReadonlyMap<string, Redaction>): unknown {
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.entries(value).map(([key, field]) => [key, rules.get(key)?.(field, literals) ?? field]));
}

const BLOCK_IDENTITY = new Set(["type", "id", "name", "textSignature", "thinkingSignature", "thoughtSignature", "namespace", "redacted", "mimeType", "data"]);
const MESSAGE_IDENTITY = new Set(["role", "timestamp", "api", "provider", "model", "responseModel", "responseId", "providerThinkingLevel",
  "usage", "stopReason", "rawStopReason", "endTurn", "deferred", "toolCallId", "toolName", "isError", "customType", "display",
  "exitCode", "cancelled", "truncated", "excludeFromContext", "fromId", "tokensBefore", "toolsAdded", "toolsRemoved"]);
const ENTRY_IDENTITY = new Set(["id", "parentId", "seq", "timestamp", "type", "customType", "terminate", "tokensBefore", "usage", "fromHook", "fromId"]);

/** A text, thinking, tool-call or image block, its content redacted. */
export const redactBlock: Redaction = (block, literals) => redactFields(block, literals, BLOCK_IDENTITY, NO_RULES);
const redactContent: Redaction = (blocks, literals) => Array.isArray(blocks) ? blocks.map((block: unknown) => redactBlock(block, literals)) : literals.value(blocks);
const MESSAGE_RULES = new Map<string, Redaction>([["content", redactContent]]);
/** Any AgentMessage: its content blocks, error text, details and summaries are content. */
export const redactMessage: Redaction = (message, literals) => redactFields(message, literals, MESSAGE_IDENTITY, MESSAGE_RULES);
const redactMessages: Redaction = (messages, literals) => Array.isArray(messages) ? messages.map((message: unknown) => redactMessage(message, literals)) : messages;
const ENTRY_RULES = new Map<string, Redaction>([["message", redactMessage], ["retainedTail", redactMessages]]);

/** The entry with its content redacted. */
export function redactEntry(entry: NewEntry, literals: KeyLiterals): NewEntry {
  return redactFields(entry, literals, ENTRY_IDENTITY, ENTRY_RULES) as NewEntry;
}

const RETRY_TEXT = new Map<string, Redaction>([["errorMessage", content]]);
const ERROR_TEXT = new Map<string, Redaction>([["message", content], ["details", content]]);
const RESULT_TEXT = new Map<string, Redaction>([["error", (error, literals) => redactNamed(error, literals, ERROR_TEXT)]]);
const PREPARATION_TEXT = new Map<string, Redaction>([["messagesToSummarize", redactMessages], ["turnPrefixMessages", redactMessages],
  ["retainedTail", redactMessages], ["messages", redactMessages], ["previousSummary", content], ["fileOps", content]]);
const TOOL_OUTPUT_TEXT = new Map<string, Redaction>([["content", redactContent], ["details", content]]);
const PENDING_MESSAGE = new Map<string, Redaction>([["payload", redactMessage]]);
const PENDING_CUSTOM = new Map<string, Redaction>([["payload", content]]);

/** A staged entry: a message payload is a message, a custom payload is content. */
const redactPendingEntry: Redaction = (pending, literals) =>
  redactNamed(pending, literals, isRecord(pending) && pending.type === "message" ? PENDING_MESSAGE : PENDING_CUSTOM);

/** pi's values by namespace, each with the rule that redacts its content. */
const VALUE_RULES = new Map<string, Redaction>([
  ["pi.op.state", (state, literals) => redactNamed(state, literals, RETRY_TEXT)],
  ["pi.result", (record, literals) => redactNamed(record, literals, RESULT_TEXT)],
  ["pi.op.preparation", (preparation, literals) => redactNamed(preparation, literals, PREPARATION_TEXT)],
  ["pi.pending.tool_output", (snapshot, literals) => redactNamed(snapshot, literals, TOOL_OUTPUT_TEXT)],
  ["pi.pending.entry", redactPendingEntry],
  ["pi.op.tool_args", content],
  ["pi.op.tool_memo", content],
  ["pi.session.name", content],
  ["pi.entry.label", content],
]);

/** pi's values stored as committed, each with the reason. */
const STORED_AS_COMMITTED = new Map<string, string>([
  ["pi.branch.tip", "an entry id, no message content"],
  ["pi.lane.config", "the lane's model and tool selection, no message content"],
  ["pi.lane.state", "operation and entry ids, no message content"],
  ["pi.op.meta", "identity pi compares with the operation's state on restore"],
]);

/** Every value namespace with reviewed handling: a redaction rule, or a reason to store it as committed. */
export const REVIEWED_VALUE_NAMESPACES: ReadonlySet<string> = new Set([...VALUE_RULES.keys(), ...STORED_AS_COMMITTED.keys()]);

/** The value set at `namespace`, with its content redacted. */
export function redactValue(namespace: string, value: unknown, literals: KeyLiterals): unknown {
  return VALUE_RULES.get(namespace)?.(value, literals) ?? value;
}
