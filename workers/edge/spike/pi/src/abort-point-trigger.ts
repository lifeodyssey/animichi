// W0-S1 spike (#1244): where each named break point sits in pi's event
// sequence.
//
//   provider_stream — `message_update` is the first event pi emits while the
//     provider stream is still being consumed, so it is the earliest honest
//     "mid provider stream" moment.
//   tool_call       — `tool_execution_start` fires before the tool's
//     `execute()` resolves; the spike's tool waits on its abort signal, so the
//     abort lands mid-execution rather than between tool calls.
//   final_frame     — a `turn_end` carrying no tool results is the last turn:
//     the only event left after it is `agent_end`, the final frame. That
//     equivalence holds exactly here because the probe never queues a steering
//     or follow-up message — the only reason pi would open another turn after
//     an empty-tool-result turn end. A turn shape where the model answers
//     without ever calling the tool would trip this early; the probe's system
//     prompt asks for the tool first, and the measured event sequence in the
//     evidence file says whether it did.

import type { AgentEvent } from "@earendil-works/pi-agent-core";
import type { AbortPoint } from "./turn-command.ts";

export function reachedAbortPoint(point: AbortPoint, event: AgentEvent): boolean {
  if (point === "provider_stream") return event.type === "message_update";
  if (point === "tool_call") return event.type === "tool_execution_start";
  return event.type === "turn_end" && event.toolResults.length === 0;
}
