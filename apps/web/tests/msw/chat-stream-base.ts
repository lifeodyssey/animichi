import { readFileSync } from "node:fs";
import { join } from "node:path";
import { http } from "msw";
import type { HttpHandler } from "msw";
import { sseResponse } from "./chat-sse";
import { TEST_ORIGIN } from "./fixtures";

export const CHAT_URL = `${TEST_ORIGIN}/v1/chat`;
export const HEALTHZ_URL = `${TEST_ORIGIN}/healthz`;

/** Every recording ends with one final full envelope frame. */
export const FINAL_FRAME_MARKER = 'data: {"type":"data-response"';

/** Offset of the final-frame marker; `last` picks the final occurrence. */
export function finalFrameOffset(recorded: string, last = false): number {
  return last ? recorded.lastIndexOf(FINAL_FRAME_MARKER) : recorded.indexOf(FINAL_FRAME_MARKER);
}

/** The recording up to (excluding) its first final data-response frame. */
export function recordingHead(name: ChatStreamFixture): string {
  const recorded = chatStreamFixture(name);
  return recorded.slice(0, finalFrameOffset(recorded));
}

/** Vitest runs with cwd = apps/web; the recordings live in the agent package. */
const FIXTURE_DIR = join(process.cwd(), "..", "agent", "tests", "fixtures", "chat_stream");

export type ChatStreamFixture = "search" | "clarify" | "error";

export function chatStreamFixture(name: ChatStreamFixture): string {
  return readFileSync(join(FIXTURE_DIR, `${name}.sse`), "utf8");
}

export interface ChatStreamOptions {
  /** Patch the recorded final frame's `session_id` (recordings capture null). */
  readonly sessionId?: string;
  /** Patch the recorded final frame's Session offer (TURN-4 #955). */
  readonly sessionOffer?: { readonly revision?: number; readonly digest?: string };
  /** Observe each request hitting the chat endpoint (headers assertions). */
  readonly spy?: (request: Request) => void;
  /** Corrupt the recorded final frame (type-invalid `success`) to probe schema guards. */
  readonly malformedFinal?: boolean;
  /** Serve this handler for a single request only (msw one-time handler). */
  readonly once?: boolean;
}

/** Map the recorded final envelope's `data`; any other line passes through. */
export function mapFinalFrameData(line: string, apply: (data: Record<string, unknown>) => Record<string, unknown>): string {
  if (!line.startsWith(FINAL_FRAME_MARKER)) return line;
  const frame = JSON.parse(line.slice("data: ".length)) as { data: Record<string, unknown> };
  if (!("success" in frame.data)) return line;
  frame.data = apply(frame.data);
  return `data: ${JSON.stringify(frame)}`;
}

function patchSessionIdLine(line: string, sessionId: string): string {
  return mapFinalFrameData(line, (data) => ({ ...data, session_id: sessionId }));
}

function patchOfferLine(line: string, offer: NonNullable<ChatStreamOptions["sessionOffer"]>): string {
  return mapFinalFrameData(line, (data) => ({
    ...data,
    ...(offer.revision === undefined ? {} : { revision: offer.revision }),
    ...(offer.digest === undefined ? {} : { session_digest: offer.digest }),
  }));
}

export function patchSessionId(text: string, sessionId?: string, offer?: ChatStreamOptions["sessionOffer"]): string {
  if (!sessionId && !offer) return text;
  return text
    .split("\n")
    .map((line) => (sessionId ? patchSessionIdLine(line, sessionId) : line))
    .map((line) => (offer ? patchOfferLine(line, offer) : line))
    .join("\n");
}

function corruptFinalFrame(text: string, malformed?: boolean): string {
  if (!malformed) return text;
  return text.replace('"success":true', '"success":"yep"');
}

export function streamText(name: ChatStreamFixture, options: ChatStreamOptions): string {
  return corruptFinalFrame(
    patchSessionId(chatStreamFixture(name), options.sessionId, options.sessionOffer),
    options.malformedFinal,
  );
}

/** A chat POST that observes the request, then streams a prebuilt SSE body. */
export function chatStreamPost(body: string, options: ChatStreamOptions = {}): HttpHandler {
  return http.post(
    CHAT_URL,
    ({ request }) => {
      options.spy?.(request);
      return sseResponse(body);
    },
    { once: options.once === true },
  );
}
