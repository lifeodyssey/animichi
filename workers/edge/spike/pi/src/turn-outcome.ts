// W0-S1 spike (#1244): what a finished turn leaves behind.
//
// The integration acceptance criterion is "abort at each of the three break
// points leaves no dangling state". This module names that state and decides
// when it is dangling, so both the unit tests and the deployed Worker answer
// the question the same way.

import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { AbortPoint, SpikeProvider } from "./turn-command.ts";

/** The subset of pi's `AgentState` that says whether a run finished cleanly. */
export interface TurnStateView {
  readonly isStreaming: boolean;
  readonly pendingToolCalls: ReadonlySet<string>;
  readonly streamingMessage?: unknown;
  readonly errorMessage?: string;
  readonly messages: readonly AgentMessage[];
}

export interface DanglingState {
  isStreaming: boolean;
  pendingToolCalls: string[];
  hasPartialMessage: boolean;
  errorMessage: string | null;
}

export interface TurnOutcome {
  runId: string;
  provider: SpikeProvider;
  abortPoint: AbortPoint | null;
  abortFired: boolean;
  events: string[];
  messageCount: number;
  text: string;
  durationMs: number;
  dangling: DanglingState;
  clean: boolean;
  error: string | null;
}

export function danglingStateOf(state: TurnStateView): DanglingState {
  return {
    isStreaming: state.isStreaming,
    pendingToolCalls: [...state.pendingToolCalls],
    hasPartialMessage: state.streamingMessage !== undefined,
    errorMessage: state.errorMessage ?? null,
  };
}

// `errorMessage` is deliberately not dangling state: after a deliberate abort
// pi records "Aborted" there, and an abort that reports itself is the correct
// outcome. Dangling means work the runtime still believes is in flight.
export function hasDanglingState(dangling: DanglingState): boolean {
  return dangling.isStreaming || dangling.pendingToolCalls.length > 0 || dangling.hasPartialMessage;
}

function textPartsOf(message: AgentMessage): string[] {
  if (message.role !== "assistant") return [];
  return message.content
    .filter((part) => part.type === "text")
    .map((part) => part.text);
}

export function assistantTextOf(messages: readonly AgentMessage[]): string {
  return messages.flatMap(textPartsOf).join("");
}
