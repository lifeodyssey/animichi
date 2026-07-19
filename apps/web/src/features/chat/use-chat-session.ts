import { useChat } from "@ai-sdk/react";
import { ChatResponseDataPart } from "@seichijunrei/contract";
import type { ChatDataPart } from "@seichijunrei/contract";
import { DefaultChatTransport } from "ai";
import type { UIMessage } from "ai";
import { useCallback, useMemo, useRef } from "react";
import type { RefObject } from "react";

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
}
type SessionRef = RefObject<SessionTracker>;

function sessionHeaders(sessionId?: string): Record<string, string> {
  return sessionId ? { "x-session-id": sessionId } : {};
}

function scopeOf(sessionId?: string): string {
  return `chat:${sessionId ?? "draft"}`;
}

/** Track the server-assigned session id, reset whenever the URL identity changes. */
function useSessionTracker(sessionId: string | undefined, scope: string): SessionRef {
  const ref = useRef<SessionTracker>({ scope, id: sessionId });
  if (ref.current.scope !== scope) {
    ref.current = { scope, id: sessionId };
  }
  return ref;
}

function captureSessionId(ref: SessionRef, part: Readonly<{ data: ChatDataPart }>): void {
  const id = part.data.session_id;
  if (typeof id === "string" && id !== "") ref.current.id = id;
}

function useCaptureSessionId(ref: SessionRef) {
  return useCallback(
    (part: Readonly<{ data: ChatDataPart }>) => {
      captureSessionId(ref, part);
    },
    [ref],
  );
}

function useSessionTransport(chatUrl: string, ref: SessionRef) {
  return useMemo(
    () =>
      new DefaultChatTransport<ChatUIMessage>({
        api: chatUrl,
        headers: () => sessionHeaders(ref.current.id),
      }),
    [chatUrl, ref],
  );
}

/**
 * `useChat` over `/v1/chat` (AI SDK UI message stream, spec S1.1 SD-9).
 *
 * The chat instance is scoped to the `?session=` identity: switching sessions
 * recreates it (official `id`-keyed reset), so an in-flight stream from the
 * previous session can never mix into the next one. The backend-assigned
 * `session_id` from `data-response` frames is fed back into follow-up requests
 * through the transport's dynamic `headers` function.
 */
export function useChatSession(chatUrl: string, sessionId?: string) {
  const scope = scopeOf(sessionId);
  const ref = useSessionTracker(sessionId, scope);
  const transport = useSessionTransport(chatUrl, ref);
  const onData = useCaptureSessionId(ref);
  return useChat<ChatUIMessage>({ id: scope, transport, dataPartSchemas, onData });
}

export type ChatSession = ReturnType<typeof useChatSession>;
