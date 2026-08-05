import { http, HttpResponse } from "msw";
import type { HttpHandler } from "msw";
import { CHAT_URL, chatStreamFixture, mapFinalFrameData, patchSessionId, streamText } from "./chat-stream-base";
import type { ChatStreamFixture, ChatStreamOptions } from "./chat-stream-base";
import { heldSse, SSE_HEADERS, sseResponse } from "./chat-sse";

export type FinalFramePatch = (envelope: Record<string, unknown>) => Record<string, unknown>;

function patchFinalFrameLine(line: string, patch: FinalFramePatch): string {
  return mapFinalFrameData(line, patch);
}

/**
 * Replay a recording with its final full envelope transformed. D-state
 * variants (D1/D2/D6/D9) are derived from the real capture this way until the
 * backend error-boundary hook (issue #272's other half) ships recordings of
 * the actual failure envelopes.
 */
export function chatStreamPatchedHandler(
  name: ChatStreamFixture,
  patch: FinalFramePatch,
  options: ChatStreamOptions = {},
): HttpHandler {
  const patched = streamText(name, options)
    .split("\n")
    .map((line) => patchFinalFrameLine(line, patch))
    .join("\n");
  return http.post(
    CHAT_URL,
    ({ request }) => {
      options.spy?.(request);
      return sseResponse(patched);
    },
    { once: options.once === true },
  );
}

/** The E2 search-results envelope: derived from the real capture, like the
 * D-state variants, until a search_bangumi results recording ships. */
export function searchResultsPatch(envelope: Record<string, unknown>): Record<string, unknown> {
  const rows = [
    { id: "p1", name: "宇治橋", latitude: 34.891, longitude: 135.807 },
    { id: "p2", name: "京阪宇治駅", latitude: 34.911, longitude: 135.806 },
    { id: "p3", name: "宇治神社", latitude: 34.9, longitude: 135.81 },
  ];
  return { ...envelope, intent: "search_bangumi", data: { results: { rows } } };
}

/** The real bypass step frames: `execute_selected_route` emits one
 * `plan_selected` running/done step pair (`test_selected_route.py`), which
 * `chat_stream._ToolPartTranslator` translates into exactly these tool
 * chunks. The UI must prove it SUPPRESSES them — a fixture without them
 * would certify the wrong tree (#461 review P1-1). */
const PLAN_SELECTED_STEP_FRAMES = [
  'data: {"type":"tool-input-start","toolCallId":"plan_selected-fixture","toolName":"plan_selected"}',
  'data: {"type":"tool-input-available","toolCallId":"plan_selected-fixture","toolName":"plan_selected","input":{}}',
  'data: {"type":"tool-output-available","toolCallId":"plan_selected-fixture","output":{"point_count":2}}',
].join("\n\n");

const START_STEP_FRAME = 'data: {"type":"start-step"}';

/**
 * The `selected_point_ids` bypass stream (issue #273 S1.7 E2): the recorded
 * search stream with the agent-path tool frames replaced by the bypass's own
 * `plan_selected` step frames, and the route re-intended as `plan_selected`.
 */
function toRecomputeStream(recording: string): string {
  return recording
    .split("\n")
    .filter((line) => !line.startsWith('data: {"type":"tool-'))
    .join("\n")
    .replace(START_STEP_FRAME, `${START_STEP_FRAME}\n\n${PLAN_SELECTED_STEP_FRAMES}`)
    .replaceAll('"intent":"plan_route"', '"intent":"plan_selected"');
}

/** Fixture self-guard: the recompute stream a test replays. Tests assert it
 * still carries the injected `plan_selected` step frames — deleting them
 * would silently re-certify the P1-1 false-green tree. */
export function recomputeStreamFixture(): string {
  return toRecomputeStream(chatStreamFixture("search"));
}

export function chatRecomputeHandler(options: ChatStreamOptions = {}): HttpHandler {
  const recorded = toRecomputeStream(streamText("search", options));
  return http.post(CHAT_URL, ({ request }) => {
    options.spy?.(request);
    return sseResponse(recorded);
  });
}

export interface ControlledChatStream {
  readonly handler: HttpHandler;
  /** Flush the recorded final data-response frame (and close), if still open. */
  readonly releaseFinal: () => void;
}

/** The recompute stream held open before its final full envelope, so a test
 * can assert the skeleton state actually appeared (review P2-⑥). */
export type ControlledRecomputeStream = ControlledChatStream;

/** A chat handler that streams the recording head and flushes the tail on release. */
function controlledChatHandler(recorded: string, splitAt: number): ControlledChatStream {
  let flush: () => void = () => undefined;
  const handler = http.post(CHAT_URL, () => {
    const held = heldSse(recorded.slice(0, splitAt), recorded.slice(splitAt));
    flush = held.flush;
    return new HttpResponse(held.stream, { headers: SSE_HEADERS });
  });
  return {
    handler,
    releaseFinal: () => {
      flush();
    },
  };
}

export function chatRecomputeControlledHandler(): ControlledRecomputeStream {
  const recorded = toRecomputeStream(chatStreamFixture("search"));
  return controlledChatHandler(recorded, recorded.lastIndexOf('data: {"type":"data-response"'));
}

/** Replays the recording up to (excluding) the first data-response frame and holds the stream open. */
export function chatStreamHeldOpenHandler(name: ChatStreamFixture): HttpHandler {
  const recorded = chatStreamFixture(name);
  const head = recorded.slice(0, recorded.indexOf('data: {"type":"data-response"'));
  return http.post(CHAT_URL, () => {
    return sseResponse(head, { close: false });
  });
}

/** Streams the recording head, then lets the test release the final frame late. */
export function chatStreamControlledHandler(
  name: ChatStreamFixture,
  sessionId: string,
): ControlledChatStream {
  const recorded = patchSessionId(chatStreamFixture(name), sessionId);
  return controlledChatHandler(recorded, recorded.indexOf('data: {"type":"data-response"'));
}
