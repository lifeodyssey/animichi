import { Chat, useChat } from "@ai-sdk/react";
import type { UseChatHelpers } from "@ai-sdk/react";
import { ChatResponseDataPart } from "@seichijunrei/contract";
import type { ChatDataPart } from "@seichijunrei/contract";
import { DefaultChatTransport, generateId } from "ai";
import type { UIMessage } from "ai";
import { useCallback, useRef } from "react";
import type { RefObject } from "react";
import { authHeaders } from "../../lib/auth/authSession";
import type { SelectedPointsBody } from "../../lib/chat/selectedPointsBypass";
import { turnstileHeaders } from "../../lib/turnstile/tokenStore";

/**
 * Typed UI message: the `data-response` part carries the contract envelope,
 * so streamed frames are schema-validated by the AI SDK before they can
 * overwrite an existing same-ID part (`dataPartSchemas`).
 */
export type ChatUIMessage = UIMessage<unknown, { response: ChatDataPart }>;

// ai@6.0.225 looks the schema up by the stripped name ("response") when
// validating whole messages but by the full chunk type ("data-response")
// while streaming, so the schema is registered under both keys.
const dataPartSchemas = {
  response: ChatResponseDataPart,
  "data-response": ChatResponseDataPart,
};

interface SessionTracker {
  scope: string;
  id: string | undefined;
  lastHttpStatus: number | undefined;
  lastErrorCode: string | undefined;
}
type SessionRef = RefObject<SessionTracker>;

function emptyTracker(scope: string, sessionId: string | undefined): SessionTracker {
  return { scope, id: sessionId, lastHttpStatus: undefined, lastErrorCode: undefined };
}

/** `x-session-id` (when known) plus a Bearer token once signed in; anonymous
 * turns simply omit Authorization and instead carry the held Turnstile token
 * (S1.9 #281) — one solved challenge covers every turn in its window. */
async function sessionHeaders(sessionId?: string): Promise<Record<string, string>> {
  const base: Record<string, string> = sessionId ? { "x-session-id": sessionId } : {};
  const auth = await authHeaders();
  const challenge = auth.Authorization === undefined ? turnstileHeaders() : {};
  return { ...base, ...challenge, ...auth };
}

function scopeOf(sessionId?: string): string {
  return `chat:${sessionId ?? "draft"}`;
}

/** Track the server-assigned session id, reset whenever the URL identity changes. */
function useSessionTracker(sessionId: string | undefined, scope: string): SessionRef {
  const ref = useRef<SessionTracker>(emptyTracker(scope, sessionId));
  if (ref.current.scope !== scope) {
    ref.current = emptyTracker(scope, sessionId);
  }
  return ref;
}

function captureSessionId(ref: SessionRef, part: Readonly<{ data: ChatDataPart }>): void {
  const id = part.data.session_id;
  if (typeof id === "string" && id !== "") ref.current.id = id;
}

/**
 * A Chat whose transport and onData are fixed at construction: `scope` is the
 * immutable epoch. `useChat`'s own onData delegates through a latest-render
 * ref, so a late frame from a previous scope's stream would invoke the new
 * scope's callback; constructing the Chat ourselves pins the callback to its
 * epoch, and the guard drops frames once the tracker moved to another scope.
 */
function createScopedChat(chatUrl: string, scope: string, ref: SessionRef): Chat<ChatUIMessage> {
  return new Chat<ChatUIMessage>({
    id: scope,
    transport: createSessionTransport(chatUrl, ref),
    dataPartSchemas,
    onData: (part) => {
      if (ref.current.scope === scope) captureSessionId(ref, part);
    },
  });
}

function errorCodeOf(body: unknown): string | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const error: unknown = (body as { error?: unknown }).error;
  if (typeof error !== "object" || error === null) return undefined;
  const code: unknown = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

/**
 * Read the rejection's error code, which separates D8 (401/403 expiry) from
 * D11 (403 `anon_budget_exhausted`). Only failures are parsed — a streaming
 * 2xx body is never touched, let alone buffered.
 */
async function readErrorCode(response: Response): Promise<string | undefined> {
  if (response.ok) return undefined;
  const body: unknown = await response
    .clone()
    .json()
    .catch(() => undefined);
  return errorCodeOf(body);
}

/** Record each chat response's status and error code so failures classify. */
function createTrackingFetch(ref: SessionRef): typeof globalThis.fetch {
  return async (input, init) => {
    ref.current.lastHttpStatus = undefined;
    ref.current.lastErrorCode = undefined;
    const response = await globalThis.fetch(input, init);
    ref.current.lastErrorCode = await readErrorCode(response);
    ref.current.lastHttpStatus = response.status;
    return response;
  };
}

function createSessionTransport(chatUrl: string, ref: SessionRef): DefaultChatTransport<ChatUIMessage> {
  return new DefaultChatTransport({
    api: chatUrl,
    headers: () => sessionHeaders(ref.current.id),
    fetch: createTrackingFetch(ref),
  });
}

interface ScopedChat {
  scope: string;
  chat: Chat<ChatUIMessage>;
}

/** Stop the outgoing scope's stream before the next scope's chat takes over. */
function switchScopedChat(
  previous: ScopedChat | null,
  chatUrl: string,
  scope: string,
  ref: SessionRef,
): ScopedChat {
  void previous?.chat.stop();
  return { scope, chat: createScopedChat(chatUrl, scope, ref) };
}

function useScopedChat(chatUrl: string, scope: string, ref: SessionRef): Chat<ChatUIMessage> {
  const holder = useRef<ScopedChat | null>(null);
  if (holder.current === null || holder.current.scope !== scope) {
    holder.current = switchScopedChat(holder.current, chatUrl, scope, ref);
  }
  return holder.current.chat;
}

/**
 * `useChat` over `/v1/chat` (AI SDK UI message stream, spec S1.1 SD-9).
 *
 * The chat instance is scoped to the `?session=` identity: switching sessions
 * stops the previous stream, recreates the Chat, and the construction-time
 * epoch guard drops any frame that still arrives late — an in-flight stream
 * from the previous session can never mix into the next one. The
 * backend-assigned `session_id` from `data-response` frames is fed back into
 * follow-up requests through the transport's dynamic `headers` function.
 */
function useTrackerReaders(ref: SessionRef) {
  const sessionIdOf = useCallback(() => ref.current.id, [ref]);
  const lastHttpStatus = useCallback(() => ref.current.lastHttpStatus, [ref]);
  const lastErrorCode = useCallback(() => ref.current.lastErrorCode, [ref]);
  return { sessionIdOf, lastHttpStatus, lastErrorCode };
}

/** A part-less turn boundary. Without it ai@6.0.225 continues the previous
 * assistant message (`createStreamingUIMessageState` reuses an assistant
 * `lastMessage`) and the same-ID `response` part would overwrite the prior
 * card instead of appending the E1 living-document version. It carries no
 * user utterance — the server must not persist a user row for it (the
 * skip-empty-utterance guard in `persistence.py`, #273 Task 3). */
function recomputeMarker(): ChatUIMessage {
  return { id: `recompute-${generateId()}`, role: "user", parts: [] };
}

type SendHelpers = Pick<UseChatHelpers<ChatUIMessage>, "sendMessage" | "setMessages">;

/**
 * E2 bypass send (issue #273 S1.7): re-submit the conversation with only a
 * `selected_point_ids` body — no new user utterance. ai@6.0.225's
 * `DefaultChatTransport` merges the per-call body (`{...resolvedBody,
 * ...options.body}`), so the field reaches `_optional_ids` unchanged.
 */
function useSendSelectedPoints({ sendMessage, setMessages }: SendHelpers) {
  return useCallback(
    (body: SelectedPointsBody) => {
      setMessages((current) => [...current, recomputeMarker()]);
      void sendMessage(undefined, { body: { ...body } });
    },
    [sendMessage, setMessages],
  );
}

export function useChatSession(chatUrl: string, sessionId?: string) {
  const scope = scopeOf(sessionId);
  const ref = useSessionTracker(sessionId, scope);
  const chat = useScopedChat(chatUrl, scope, ref);
  const helpers = useChat<ChatUIMessage>({ chat });
  return { ...helpers, sendSelectedPoints: useSendSelectedPoints(helpers), ...useTrackerReaders(ref) };
}

export type ChatSession = ReturnType<typeof useChatSession>;
