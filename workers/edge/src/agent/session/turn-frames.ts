/**
 * The SD-9 frames one running turn pushes to whoever is connected (card #1252,
 * spec `docs/specs/2026-09-01-agent-ts-rewrite-spec.md` §三 "若有连接在则按 SD-9
 * 帧推 SSE").
 *
 * SD-9 is the AI SDK UI message-stream protocol (frontend-rebuild spec §"Global
 * convention: Chat streaming protocol"), so the wire shapes here are not a
 * design decision of this card — they are read off the RECORDED captures the web
 * suite replays, `apps/agent/tests/fixtures/chat_stream/*.sse`, which is also
 * what `apps/web`'s `use-chat-session.ts` feeds to `@ai-sdk/react`. Every frame
 * below appears verbatim in one of those files, including the `data:`-only
 * framing (the protocol carries its discriminator INSIDE the JSON, so an SSE
 * `event:` line would be a second, contradictory one).
 *
 * WHAT IS NOT HERE: the `data-response` part carrying the answer payload. Its
 * schema is `packages/contract`'s `ChatResponseDataPart`, projected in Python by
 * `chat_stream_frames.chat_response_wire` from a `PublicAPIResponse` that has no
 * TypeScript counterpart yet — that projection arrives with the structured
 * output work, and inventing a shape for it here would fork the contract. Until
 * then the answer reaches the client the way §二's disconnect semantics say it
 * always can: from `GET /v1/conversations/:id/messages`, which reads the
 * assistant message this turn commits.
 *
 * Frames are never persisted (§三: "订阅者**不持久化**"). They are a live view
 * of a turn whose truth is in Neon.
 */
import type { AgentEvent } from "@earendil-works/pi-agent-core";
import type { JsonValue } from "@earendil-works/pi-ai";
import { isJsonRecord } from "../json-record.ts";
import type { TurnState } from "./run-machine.ts";

/** One decoded frame; the channel encodes it as `data: <json>`. */
export type TurnFrame = Record<string, JsonValue>;

/** The stream terminator, which is a bare token rather than JSON. */
export const DONE_FRAME = "[DONE]";

/** The client-facing failure text, verbatim from the Python `_ERROR_TEXT`. */
export const ERROR_TEXT = "Something went wrong. Please try again.";

/** The frames that open every stream: the message, then its first step. */
export function openingFrames(): TurnFrame[] {
  return [{ type: "start" }, { type: "start-step" }];
}

/**
 * An untrusted runtime value as the protocol carries it. pi types a tool's
 * arguments and result as `any`; the frames are JSON either way, so the one
 * narrowing happens here rather than at four call sites.
 */
function jsonOf(value: unknown): JsonValue {
  return value === undefined ? null : (value as JsonValue);
}

/** A tool's structured payload, as `tool-output-available` carries it. */
function outputOf(result: unknown): JsonValue {
  return jsonOf(isJsonRecord(result) ? result.details : null);
}

function toolInputFrames(event: Extract<AgentEvent, { type: "tool_execution_start" }>): TurnFrame[] {
  const { toolCallId, toolName } = event;
  return [
    { type: "tool-input-start", toolCallId, toolName },
    { type: "tool-input-available", toolCallId, toolName, input: jsonOf(event.args) },
  ];
}

function toolOutputFrames(event: Extract<AgentEvent, { type: "tool_execution_end" }>): TurnFrame[] {
  const { toolCallId } = event;
  if (event.isError) return [{ type: "tool-output-error", toolCallId, errorText: ERROR_TEXT }];
  return [{ type: "tool-output-available", toolCallId, output: outputOf(event.result) }];
}

/** The frames one pi agent event becomes; most events become none. */
export function framesFor(event: AgentEvent): TurnFrame[] {
  if (event.type === "tool_execution_start") return toolInputFrames(event);
  if (event.type === "tool_execution_end") return toolOutputFrames(event);
  return [];
}

/** The frames that close a stream, told apart by how the turn ended. */
export function closingFrames(state: TurnState): TurnFrame[] {
  if (state.phase === "succeeded") {
    return [{ type: "finish-step" }, { type: "finish", finishReason: "stop" }];
  }
  return [
    { type: "error", errorText: ERROR_TEXT },
    { type: "finish-step" },
    { type: "finish", finishReason: "error" },
  ];
}
