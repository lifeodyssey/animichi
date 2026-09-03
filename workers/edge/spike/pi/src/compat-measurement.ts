// W0-S2 spike (#1245): what one compat-switch turn is worth measuring.
//
// The four questions the switch table asks of every row:
//   tool round trip — did the provider ask for `lookup_spot`, accept the tool
//     result back, and then answer? A switch that breaks the second request
//     (`requiresToolResultName`, `requiresAssistantAfterToolResult`,
//     `supportsStrictMode`) shows up here and nowhere else, so a completed tool
//     call alone is not enough: the answer after it is part of the round trip.
//   streaming usage — did token counts come back on the stream? pi only sends
//     `stream_options: { include_usage: true }` when `supportsUsageInStreaming`
//     is not false (pi-ai `dist/api/openai-completions.js:594`), and leaves the
//     counts at zero when the gateway sends none, so a non-zero total is the
//     honest signal.
//   wall ms / first token ms — the S1 baseline for mimo direct was a 52 s round
//     trip (spec appendix A). Splitting it into "time until the first content
//     delta" and "total" is what says whether a switch changed the model's
//     behaviour or only the transport.

import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { CompatCommand } from "./compat-command.ts";
import type { MimoCompat, MimoRouteName } from "./compat-switch.ts";
import { assistantTextOf, type TurnStateView } from "./turn-outcome.ts";

export interface CompatMeasurement {
  route: MimoRouteName;
  compat: MimoCompat;
  toolCallSucceeded: boolean;
  answered: boolean;
  toolRoundTrip: boolean;
  streamingUsage: boolean;
  usageTokens: number;
  wallMs: number;
  /** Time to the first content delta, or null when the turn produced none. */
  firstTokenMs: number | null;
  events: string[];
  error: string | null;
}

/** What the probe watched happen while the turn ran. */
export interface TurnObservation {
  events: string[];
  firstTokenMs: number | null;
  toolCallSucceeded: boolean;
  wallMs: number;
  /** A throw that escaped `prompt()`, as opposed to one pi recorded on state. */
  thrown: string | null;
}

function usageTokensOf(message: AgentMessage): number {
  return message.role === "assistant" ? message.usage.totalTokens : 0;
}

export function streamedUsageTokensOf(messages: readonly AgentMessage[]): number {
  return messages.reduce((total, message) => total + usageTokensOf(message), 0);
}

export function measurementOf(
  command: CompatCommand,
  observation: TurnObservation,
  state: TurnStateView,
): CompatMeasurement {
  const usageTokens = streamedUsageTokensOf(state.messages);
  const answered = assistantTextOf(state.messages).length > 0;
  return {
    route: command.route,
    compat: command.compat,
    toolCallSucceeded: observation.toolCallSucceeded,
    answered,
    toolRoundTrip: observation.toolCallSucceeded && answered,
    streamingUsage: usageTokens > 0,
    usageTokens,
    wallMs: observation.wallMs,
    firstTokenMs: observation.firstTokenMs,
    events: [...observation.events],
    error: observation.thrown ?? state.errorMessage ?? null,
  };
}
