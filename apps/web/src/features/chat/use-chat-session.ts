import { Chat, useChat } from "@ai-sdk/react";
import { ChatResponseDataPart } from "@seichijunrei/contract";
import type { ChatDataPart } from "@seichijunrei/contract";
import { DefaultChatTransport } from "ai";
import type { UIMessage } from "ai";
import { useCallback, useRef } from "react";
import type { RefObject } from "react";
import { authHeaders } from "../../lib/auth/authSession";
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
}
type SessionRef = RefObject<SessionTracker>;

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
  const ref = useRef<SessionTracker>({ scope, id: sessionId, lastHttpStatus: undefined });
  if (ref.current.scope !== scope) {
    ref.current = { scope, id: sessionId, lastHttpStatus: undefined };
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

/** Record each chat response's HTTP status so failures classify (401 → D8). */
function createTrackingFetch(ref: SessionRef): typeof globalThis.fetch {
  return async (input, init) => {
    ref.current.lastHttpStatus = undefined;
    const response = await globalThis.fetch(input, init);
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
export function useChatSession(chatUrl: string, sessionId?: string) {
  const scope = scopeOf(sessionId);
  const ref = useSessionTracker(sessionId, scope);
  const chat = useScopedChat(chatUrl, scope, ref);
  const sessionIdOf = useCallback(() => ref.current.id, [ref]);
  const lastHttpStatus = useCallback(() => ref.current.lastHttpStatus, [ref]);
  return { ...useChat<ChatUIMessage>({ chat }), sessionIdOf, lastHttpStatus };
}

export type ChatSession = ReturnType<typeof useChatSession>;
