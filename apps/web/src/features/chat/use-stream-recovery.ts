import { useCallback, useState } from "react";
import { clearAuthToken } from "../../lib/auth/auth-session";
import type { ChatUIMessage } from "./use-chat-session";
import { fetchHistory } from "./use-conversation-history";
import type { HistoryEntry } from "./use-conversation-history";
export interface StreamRecovery {
  readonly recover: () => void;
  readonly recoverLatest: () => void;
  readonly recoverExpired: () => void;
  readonly recovering: boolean;
}

/** The slice of the chat session the recovery flow drives. */
export interface RecoverableChat {
  readonly setMessages: (messages: ChatUIMessage[]) => void;
  readonly clearError: () => void;
  readonly regenerate: () => Promise<void>;
}

/**
 * The failed step retry actually owes the visitor (W1 #1220): when the
 * failure was a structured clarify pick, "retry" re-sends that pick — it
 * never replays history, because the history never contained the pick.
 */
export interface FailedStepResend {
  readonly failed: boolean;
  readonly resend: () => void;
}

function toRecoveredMessage(entry: HistoryEntry, index: number): ChatUIMessage {
  return {
    id: `recovered-${String(index)}`,
    role: entry.role === "user" ? "user" : "assistant",
    parts: [{ type: "text", text: entry.content }],
  };
}

async function replaceWithFinalState(baseUrl: string, chat: RecoverableChat, sessionId: string): Promise<void> {
  const page = await fetchHistory(baseUrl, sessionId);
  chat.setMessages(page.entries.map((entry, index) => toRecoveredMessage(entry, index)));
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
 *
 * `recover` first hands a failed structured pick back to its own resend
 * (W1 #1220); `recoverLatest` always re-reads state — the D16/D17 conflict
 * recovery, where replaying the same request would only conflict again.
 */
function useRecoverLatest(baseUrl: string, chat: RecoverableChat, sessionIdOf: () => string | undefined) {
  const [recovering, setRecovering] = useState(false);
  const recoverLatest = useCallback(() => {
    runRecovery({ baseUrl, chat, sessionId: sessionIdOf(), setRecovering });
  }, [baseUrl, chat, sessionIdOf]);
  return { recoverLatest, recovering };
}

export function useStreamRecovery(
  baseUrl: string,
  chat: RecoverableChat,
  sessionIdOf: () => string | undefined,
  failedPick?: FailedStepResend,
): StreamRecovery {
  const { recoverLatest, recovering } = useRecoverLatest(baseUrl, chat, sessionIdOf);
  const recover = useRecoverFailedStep(recoverLatest, failedPick);
  return { recover, recoverLatest, recoverExpired: useRecoverExpired(recoverLatest), recovering };
}

function useRecoverExpired(recoverLatest: () => void) {
  return useCallback(() => { clearAuthToken(); recoverLatest(); }, [recoverLatest]);
}

function useRecoverFailedStep(recoverLatest: () => void, failedPick: FailedStepResend | undefined) {
  return useCallback(() => {
    if (failedPick?.failed === true) { failedPick.resend(); return; }
    recoverLatest();
  }, [recoverLatest, failedPick]);
}
