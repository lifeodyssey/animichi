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
}

function streamText(name: ChatStreamFixture, sessionId?: string): string {
  const text = chatStreamFixture(name);
  if (!sessionId) return text;
  return text.replaceAll('"session_id":null', `"session_id":"${sessionId}"`);
}

export function chatStreamHandler(
  name: ChatStreamFixture,
  options: ChatStreamOptions = {},
): HttpHandler {
  return http.post(CHAT_URL, ({ request }) => {
    options.spy?.(request);
    return sseResponse(streamText(name, options.sessionId));
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

function sseResponse(
  text: string,
  { close = true }: Readonly<{ close?: boolean }> = {},
): HttpResponse<ReadableStream<Uint8Array>> {
  return new HttpResponse(sseBody(text, close), {
    headers: {
      "content-type": "text/event-stream",
      "x-vercel-ai-ui-message-stream": "v1",
    },
  });
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

export function conversationMessagesHandler(
  sessionId: string,
  rows: readonly HistoryRowFixture[],
): HttpHandler {
  const url = `${TEST_ORIGIN}/v1/conversations/${encodeURIComponent(sessionId)}/messages`;
  return http.get(url, () => HttpResponse.json({ messages: rows }));
}
