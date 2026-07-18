import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useMemo } from "react";

function sessionHeaders(sessionId?: string): Record<string, string> {
  return sessionId ? { "x-session-id": sessionId } : {};
}

/** `useChat` over `/v1/chat` (AI SDK UI message stream, spec S1.1 SD-9). */
export function useChatSession(chatUrl: string, sessionId?: string) {
  const transport = useMemo(
    () => new DefaultChatTransport({ api: chatUrl, headers: sessionHeaders(sessionId) }),
    [chatUrl, sessionId],
  );
  return useChat({ transport });
}

export type ChatSession = ReturnType<typeof useChatSession>;
