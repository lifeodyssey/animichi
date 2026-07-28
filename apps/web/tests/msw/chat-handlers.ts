import { readFileSync } from "node:fs";
import { join } from "node:path";
import { http, HttpResponse } from "msw";
import type { HttpHandler } from "msw";
import { TEST_ORIGIN } from "./fixtures";

/**
 * Chat swimlane helpers. Stream bodies are REAL recordings replayed from
 * `apps/agent/tests/fixtures/chat_stream/*.sse` (E1's captures) — handlers
 * never hand-write AI SDK frames.
 */
export const CHAT_URL = `${TEST_ORIGIN}/v1/chat`;
export const HEALTHZ_URL = `${TEST_ORIGIN}/healthz`;

/** Vitest runs with cwd = apps/web; the recordings live in the agent package. */
const FIXTURE_DIR = join(process.cwd(), "..", "agent", "tests", "fixtures", "chat_stream");

export type ChatStreamFixture = "search" | "clarify" | "error";

export function chatStreamFixture(name: ChatStreamFixture): string {
  return readFileSync(join(FIXTURE_DIR, `${name}.sse`), "utf8");
}

function sseBody(text: string, close: boolean): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
      if (close) controller.close();
    },
  });
}

export interface ChatStreamOptions {
  /** Patch the recorded final frame's `session_id` (recordings capture null). */
  readonly sessionId?: string;
  /** Observe each request hitting the chat endpoint (headers assertions). */
  readonly spy?: (request: Request) => void;
  /** Corrupt the recorded final frame (type-invalid `success`) to probe schema guards. */
  readonly malformedFinal?: boolean;
  /** Serve this handler for a single request only (msw one-time handler). */
  readonly once?: boolean;
}

function patchSessionId(text: string, sessionId?: string): string {
  if (!sessionId) return text;
  return text
    .split("\n")
    .map((line) => patchSessionIdLine(line, sessionId))
    .join("\n");
}

/** The recordings omit the null `session_id`; inject it into full final frames. */
function patchSessionIdLine(line: string, sessionId: string): string {
  if (!line.startsWith('data: {"type":"data-response"')) return line;
  const frame = JSON.parse(line.slice("data: ".length)) as { data: Record<string, unknown> };
  if (!("success" in frame.data)) return line;
  frame.data.session_id = sessionId;
  return `data: ${JSON.stringify(frame)}`;
}

function corruptFinalFrame(text: string, malformed?: boolean): string {
  if (!malformed) return text;
  return text.replace('"success":true', '"success":"yep"');
}

function streamText(name: ChatStreamFixture, options: ChatStreamOptions): string {
  return corruptFinalFrame(
    patchSessionId(chatStreamFixture(name), options.sessionId),
    options.malformedFinal,
  );
}

export function chatStreamHandler(
  name: ChatStreamFixture,
  options: ChatStreamOptions = {},
): HttpHandler {
  return http.post(CHAT_URL, ({ request }) => {
    options.spy?.(request);
    return sseResponse(streamText(name, options));
  });
}

const RETRY_TOOL = "search_bangumi";
const RETRY_ID = `${RETRY_TOOL}-retry`;

function retryFrames(): string {
  return [
    `data: {"type":"tool-output-error","toolCallId":"${RETRY_TOOL}-fixture","errorText":"duplicate call deflected"}`,
    `data: {"type":"tool-input-start","toolCallId":"${RETRY_ID}","toolName":"${RETRY_TOOL}"}`,
    `data: {"type":"tool-input-available","toolCallId":"${RETRY_ID}","toolName":"${RETRY_TOOL}","input":{"bangumi_id":12345}}`,
    `data: {"type":"tool-output-available","toolCallId":"${RETRY_ID}","output":{"row_count":2}}`,
  ].join("\n\n");
}

/**
 * On `ModelRetry` the agent closes the in-flight tool part as an error and re-issues the
 * call under a fresh id (#430). No recording of that shape exists yet — the backend change
 * is unmerged — so the sequence is derived from the real search capture, like the D-state
 * variants above.
 */
export function chatStreamRetryHandler(): HttpHandler {
  const settled = `data: {"type":"tool-output-available","toolCallId":"${RETRY_TOOL}-fixture","output":{"row_count":2}}`;
  const recorded = chatStreamFixture("search").replace(settled, retryFrames());
  return http.post(CHAT_URL, () => sseResponse(recorded));
}

/** Bare HTTP failure on the chat endpoint (401 expiry → D8, 5xx → D4). */
export function chatHttpErrorHandler(status: number): HttpHandler {
  return http.post(CHAT_URL, () => new HttpResponse(null, { status }));
}

/** A JSON rejection carrying no error code — must not be promoted to D11. */
export function chatCodelessErrorHandler(status: number): HttpHandler {
  return http.post(CHAT_URL, () => HttpResponse.json({ detail: "denied" }, { status }));
}

/** The anonymous daily-budget breaker's rejection (issue #274 S1.8 X4 → D11). */
export function chatBudgetExhaustedHandler(): HttpHandler {
  const body = { error: { code: "anon_budget_exhausted", action: "login" } };
  return http.post(CHAT_URL, () => HttpResponse.json(body, { status: 403 }));
}

function droppingBody(head: string): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      if (head !== "") controller.enqueue(new TextEncoder().encode(head));
      controller.error(new Error("connection lost"));
    },
  });
}

/** Replays the recording head, then drops the connection mid-stream (D4). */
export function chatStreamDropHandler(name: ChatStreamFixture): HttpHandler {
  const recorded = chatStreamFixture(name);
  const head = recorded.slice(0, recorded.indexOf('data: {"type":"data-response"'));
  return http.post(CHAT_URL, () => new HttpResponse(droppingBody(head), { headers: SSE_HEADERS }));
}

/** Drops the connection before any frame arrives (D4 before-first-chunk). */
export function chatStreamImmediateDropHandler(): HttpHandler {
  return http.post(CHAT_URL, () => new HttpResponse(droppingBody(""), { headers: SSE_HEADERS }));
}

export type FinalFramePatch = (envelope: Record<string, unknown>) => Record<string, unknown>;

function patchFinalFrameLine(line: string, patch: FinalFramePatch): string {
  if (!line.startsWith('data: {"type":"data-response"')) return line;
  const frame = JSON.parse(line.slice("data: ".length)) as { data: Record<string, unknown> };
  if (!("success" in frame.data)) return line;
  frame.data = patch(frame.data);
  return `data: ${JSON.stringify(frame)}`;
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

function stripToolFrames(recording: string): string {
  return recording
    .split("\n")
    .filter((line) => !line.startsWith('data: {"type":"tool-'))
    .join("\n")
    .replaceAll('"intent":"plan_route"', '"intent":"plan_selected"');
}

/**
 * The `selected_point_ids` bypass stream (issue #273 S1.7 E2): the recorded
 * search stream with every tool frame stripped and the route re-intended as
 * `plan_selected` — the bypass never runs the agent, so no pipeline streams.
 */
export function chatRecomputeHandler(options: ChatStreamOptions = {}): HttpHandler {
  const recorded = stripToolFrames(streamText("search", options));
  return http.post(CHAT_URL, ({ request }) => {
    options.spy?.(request);
    return sseResponse(recorded);
  });
}

/** Replays the recording up to (excluding) the first data-response frame and holds the stream open. */
export function chatStreamHeldOpenHandler(name: ChatStreamFixture): HttpHandler {
  const recorded = chatStreamFixture(name);
  const head = recorded.slice(0, recorded.indexOf('data: {"type":"data-response"'));
  return http.post(CHAT_URL, () => {
    return sseResponse(head, { close: false });
  });
}

export interface ControlledChatStream {
  readonly handler: HttpHandler;
  /** Flush the recorded final data-response frame (and close), if still open. */
  readonly releaseFinal: () => void;
}

/** Streams the recording head, then lets the test release the final frame late. */
export function chatStreamControlledHandler(
  name: ChatStreamFixture,
  sessionId: string,
): ControlledChatStream {
  const recorded = patchSessionId(chatStreamFixture(name), sessionId);
  const splitAt = recorded.indexOf('data: {"type":"data-response"');
  let release: () => void = () => undefined;
  const handler = http.post(CHAT_URL, () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(recorded.slice(0, splitAt)));
        release = () => {
          flushTail(controller, recorded.slice(splitAt));
        };
      },
    });
    return new HttpResponse(body, { headers: SSE_HEADERS });
  });
  return {
    handler,
    releaseFinal: () => {
      release();
    },
  };
}

function flushTail(controller: ReadableStreamDefaultController<Uint8Array>, tail: string): void {
  try {
    controller.enqueue(new TextEncoder().encode(tail));
    controller.close();
  } catch {
    // The consumer aborted the stream first: the late frame has nowhere to go.
  }
}

const SSE_HEADERS = {
  "content-type": "text/event-stream",
  "x-vercel-ai-ui-message-stream": "v1",
};

function sseResponse(
  text: string,
  { close = true }: Readonly<{ close?: boolean }> = {},
): HttpResponse<ReadableStream<Uint8Array>> {
  return new HttpResponse(sseBody(text, close), { headers: SSE_HEADERS });
}

export const healthzOkHandler = http.get(HEALTHZ_URL, () =>
  HttpResponse.json({ status: "ok" }),
);

export const healthzDownHandler = http.get(HEALTHZ_URL, () => HttpResponse.error());

export interface HistoryRowFixture {
  readonly role: string;
  readonly content: string;
  readonly response_data?: { readonly intent?: string; readonly success?: boolean } | null;
}

export function conversationMessagesErrorHandler(sessionId: string, status: number): HttpHandler {
  const url = `${TEST_ORIGIN}/v1/conversations/${encodeURIComponent(sessionId)}/messages`;
  return http.get(url, () => new HttpResponse(null, { status }));
}

export function conversationMessagesHandler(
  sessionId: string,
  rows: readonly HistoryRowFixture[],
  spy?: (request: Request) => void,
): HttpHandler {
  const url = `${TEST_ORIGIN}/v1/conversations/${encodeURIComponent(sessionId)}/messages`;
  return http.get(url, ({ request }) => {
    spy?.(request);
    return HttpResponse.json({ messages: rows });
  });
}
