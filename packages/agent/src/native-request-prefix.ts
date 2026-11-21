import {
  declarationsEqual, getCurrentSystemPrompt, getCurrentTools, toToolDeclaration,
  type Message, type Tool,
} from "@earendil-works/pi-ai";
import { NATIVE_SYSTEM_PROMPT } from "./native-configuration.ts";
import { NATIVE_TOOLS, NATIVE_TOOL_ORDER } from "./native-tools.ts";

/** The model request prefix: the system prompt and the advertised tools, in order. */
export interface RequestPrefix {
  readonly prompt: string;
  readonly tools: readonly Tool[];
}

/** The prefix a provider actually receives, replayed from the sent transcript. */
export function requestPrefixOf(messages: readonly Message[]): RequestPrefix {
  return { prompt: getCurrentSystemPrompt(messages), tools: getCurrentTools(messages) };
}

/** Exact bytes of the prefix; tool declarations drop executable fields, as the provider sees them. */
export function serializePrefix(prefix: RequestPrefix): string {
  return JSON.stringify({ prompt: prefix.prompt, tools: prefix.tools.map(toToolDeclaration) });
}

/** Every prefix-instability source between two requests, each named by what moved. */
export function prefixDrift(before: RequestPrefix, after: RequestPrefix): string[] {
  return [...promptDrift(before.prompt, after.prompt), ...toolsDrift(before.tools, after.tools)];
}

/** Every way one sent prefix no longer matches the pinned production advertisement. */
export function pinnedPrefixDrift(prefix: RequestPrefix): string[] {
  const names = prefix.tools.map((tool) => tool.name);
  const drift = promptDrift(NATIVE_SYSTEM_PROMPT, prefix.prompt);
  if (!sameOrder(NATIVE_TOOL_ORDER, names)) {
    drift.push(`advertised tool order differs from the pinned list: [${names.join(", ")}]`
      + ` (pinned [${NATIVE_TOOL_ORDER.join(", ")}])`);
    return drift;
  }
  return [...drift, ...NATIVE_TOOLS.flatMap((tool, index) => declarationDrift(tool, prefix.tools[index]))];
}

export function assertPrefixStable(before: RequestPrefix, after: RequestPrefix): void {
  fail(prefixDrift(before, after), "model request prefix drifted");
}

export function assertPrefixPinned(prefix: RequestPrefix): void {
  fail(pinnedPrefixDrift(prefix), "model request prefix no longer matches the pinned advertisement");
}

function toolsDrift(before: readonly Tool[], after: readonly Tool[]): string[] {
  const beforeNames = before.map((tool) => tool.name);
  const afterNames = after.map((tool) => tool.name);
  if (!sameOrder(beforeNames, afterNames)) {
    return [`tool order changed: [${beforeNames.join(", ")}] -> [${afterNames.join(", ")}]`];
  }
  return before.flatMap((tool, index) => declarationDrift(tool, after[index]));
}

function declarationDrift(tool: Tool, other: Tool | undefined): string[] {
  return other !== undefined && !declarationsEqual(tool, other) ? [`tool declaration changed: ${tool.name}`] : [];
}

function promptDrift(before: string, after: string): string[] {
  if (before === after) return [];
  const difference = firstDifference(before, after);
  return [`system prompt changed at line ${String(difference.index + 1)}:`
    + ` ${quoted(difference.earlier)} -> ${quoted(difference.later)}`];
}

function firstDifference(before: string, after: string): { index: number; earlier: string; later: string } {
  const earlierLines = before.split("\n");
  const laterLines = after.split("\n");
  const found = earlierLines.findIndex((line, position) => line !== laterLines[position]);
  const index = found === -1 ? Math.min(earlierLines.length, laterLines.length) : found;
  return { index, earlier: earlierLines[index] ?? "<absent>", later: laterLines[index] ?? "<absent>" };
}

function sameOrder(before: readonly string[], after: readonly string[]): boolean {
  return before.length === after.length && before.every((name, index) => name === after[index]);
}

function quoted(line: string): string {
  return JSON.stringify(line.length > 80 ? `${line.slice(0, 77)}...` : line);
}

function fail(drift: readonly string[], headline: string): void {
  if (drift.length > 0) throw new Error(`${headline}:\n- ${drift.join("\n- ")}`);
}
