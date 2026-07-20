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
