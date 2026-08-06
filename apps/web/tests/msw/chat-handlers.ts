import { http, HttpResponse } from "msw";
import type { HttpHandler } from "msw";
import { TURNSTILE_HEADER } from "../../src/lib/turnstile/tokenStore";
import { CHAT_URL, HEALTHZ_URL, chatStreamFixture, chatStreamPost, recordingHead, streamText } from "./chat-stream-base";
import type { ChatStreamFixture, ChatStreamOptions } from "./chat-stream-base";
import { sseResponse, SSE_HEADERS } from "./chat-sse";
import { TEST_ORIGIN } from "./fixtures";

export { CHAT_URL, HEALTHZ_URL } from "./chat-stream-base";
export type { ChatStreamFixture, ChatStreamOptions } from "./chat-stream-base";
export { chatStreamFixture, patchSessionId, streamText } from "./chat-stream-base";
export type {
  ControlledChatStream,
  ControlledRecomputeStream,
  FinalFramePatch,
} from "./chat-recompute-handlers";
export {
  chatRecomputeControlledHandler,
  chatRecomputeHandler,
  chatStreamControlledHandler,
  chatStreamHeldOpenHandler,
  chatStreamPatchedHandler,
  recomputeStreamFixture,
  searchResultsPatch,
} from "./chat-recompute-handlers";

/**
 * Chat swimlane helpers. Stream bodies are REAL recordings replayed from
 * `apps/agent/tests/fixtures/chat_stream/*.sse` (E1's captures) — handlers
 * never hand-write AI SDK frames.
 */

export function chatStreamHandler(
  name: ChatStreamFixture,
  options: ChatStreamOptions = {},
): HttpHandler {
  return chatStreamPost(streamText(name, options), options);
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

const TURNSTILE_REJECTION = {
  error: { code: "turnstile_required", message: "Turnstile verification required.", retryable: true },
};

/** The armed edge gate's retryable rejection (issue #447, `workers/edge/turnstile.ts`). */
export function chatTurnstileRequiredHandler(spy?: (request: Request) => void): HttpHandler {
  return http.post(CHAT_URL, ({ request }) => {
    spy?.(request);
    return HttpResponse.json(TURNSTILE_REJECTION, { status: 403 });
  });
}

/**
 * The armed edge as it actually behaves: a turn WITHOUT a solved token is
 * challenged, a turn with one streams. A handler that answers 200 regardless
 * cannot tell a tokenless resend from a real recovery (issue #447 review).
 */
export function armedChatHandler(
  name: ChatStreamFixture,
  seen: (string | null)[],
  spent: readonly string[] = [],
  options: ChatStreamOptions = {},
): HttpHandler {
  return http.post(CHAT_URL, ({ request }) => {
    const token = request.headers.get(TURNSTILE_HEADER);
    seen.push(token);
    const usable = token !== null && token !== "" && !spent.includes(token);
    if (!usable) return HttpResponse.json(TURNSTILE_REJECTION, { status: 403 });
    return sseResponse(streamText(name, options));
  });
}

/** The anonymous daily-budget breaker's rejection (issue #274 S1.8 X4 → D11). */
export function chatBudgetExhaustedHandler(): HttpHandler {
  const body = {
    error: { code: "anon_budget_exhausted", message: "Anonymous budget exhausted.", action: "login" },
  };
  return http.post(CHAT_URL, () => HttpResponse.json(body, { status: 403 }));
}

/** #282 S1.10: this identity's own daily message quota, not the shared budget. */
export function chatQuotaExhaustedHandler(resetsAt?: string): HttpHandler {
  const data = resetsAt === undefined ? undefined : { quota_resets_at: resetsAt };
  const body = {
    error: { code: "anon_quota_exhausted", message: "Anonymous quota exhausted.", action: "login", data },
  };
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
  return http.post(CHAT_URL, () => new HttpResponse(droppingBody(recordingHead(name)), { headers: SSE_HEADERS }));
}

/** Drops the connection before any frame arrives (D4 before-first-chunk). */
export function chatStreamImmediateDropHandler(): HttpHandler {
  return http.post(CHAT_URL, () => new HttpResponse(droppingBody(""), { headers: SSE_HEADERS }));
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
