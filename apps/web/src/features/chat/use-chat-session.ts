import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useCallback, useMemo, useRef } from "react";
import type { RefObject } from "react";

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

function extractSessionId(data: unknown): string | undefined {
  if (typeof data !== "object" || data === null) return undefined;
  const value: unknown = Reflect.get(data, "session_id");
  return typeof value === "string" && value !== "" ? value : undefined;
}

function captureSessionId(ref: SessionRef, part: Readonly<{ type: string; data: unknown }>): void {
  if (part.type !== "data-response") return;
  const id = extractSessionId(part.data);
  if (id) ref.current.id = id;
}

function useCaptureSessionId(ref: SessionRef) {
  return useCallback(
    (part: Readonly<{ type: string; data: unknown }>) => {
      captureSessionId(ref, part);
    },
    [ref],
  );
}

function useSessionTransport(chatUrl: string, ref: SessionRef) {
  return useMemo(
    () => new DefaultChatTransport({ api: chatUrl, headers: () => sessionHeaders(ref.current.id) }),
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
  return useChat({ id: scope, transport, onData });
}

export type ChatSession = ReturnType<typeof useChatSession>;
