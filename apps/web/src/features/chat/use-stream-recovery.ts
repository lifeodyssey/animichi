import { useCallback, useState } from "react";
import { clearAuthToken } from "../../lib/auth/authSession";
import type { ChatUIMessage } from "./use-chat-session";
import { fetchHistory } from "./use-conversation-history";
import type { HistoryEntry } from "./use-conversation-history";

export interface StreamRecovery {
  readonly recover: () => void;
  readonly recoverExpired: () => void;
  readonly recovering: boolean;
}

/** The slice of the chat session the recovery flow drives. */
export interface RecoverableChat {
  readonly setMessages: (messages: ChatUIMessage[]) => void;
  readonly clearError: () => void;
  readonly regenerate: () => Promise<void>;
}

function toRecoveredMessage(entry: HistoryEntry, index: number): ChatUIMessage {
  return {
    id: `recovered-${String(index)}`,
    role: entry.role === "user" ? "user" : "assistant",
    parts: [{ type: "text", text: entry.content }],
  };
}

async function replaceWithFinalState(baseUrl: string, chat: RecoverableChat, sessionId: string): Promise<void> {
  const entries = await fetchHistory(baseUrl, sessionId);
  chat.setMessages(entries.map((entry, index) => toRecoveredMessage(entry, index)));
  chat.clearError();
}

interface RecoveryRun {
  readonly baseUrl: string;
  readonly chat: RecoverableChat;
  readonly sessionId: string | undefined;
  readonly setRecovering: (value: boolean) => void;
}

function runRecovery({ baseUrl, chat, sessionId, setRecovering }: RecoveryRun): void {
  if (!sessionId) { chat.clearError(); void chat.regenerate(); return; }
  setRecovering(true);
  void replaceWithFinalState(baseUrl, chat, sessionId)
    .catch(() => undefined)
    .finally(() => { setRecovering(false); });
}

/**
 * P6 disconnect-recovery semantics: a broken AI SDK stream is never resumed.
 * With a known session the client re-reads the session's final state via
 * GET /v1/conversations/{id}/messages; without one (nothing persisted yet)
 * the failed turn is regenerated instead.
 */
export function useStreamRecovery(baseUrl: string, chat: RecoverableChat, sessionIdOf: () => string | undefined): StreamRecovery {
  const [recovering, setRecovering] = useState(false);
  const recover = useCallback(() => {
    runRecovery({ baseUrl, chat, sessionId: sessionIdOf(), setRecovering });
  }, [baseUrl, chat, sessionIdOf]);
  const recoverExpired = useCallback(() => { clearAuthToken(); recover(); }, [recover]);
  return { recover, recoverExpired, recovering };
}
