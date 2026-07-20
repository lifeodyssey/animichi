import { useCallback, useEffect, useMemo, useRef } from "react";
import { useLocale } from "../../i18n/context";
import { classifyFailure } from "../../lib/chat/errorClassifier";
import type { ChatErrorState, FailureSignal } from "../../lib/chat/errorClassifier";
import { ChatActionsProvider } from "./chat-actions";
import type { ChatActions } from "./chat-actions";
import { ChatInput } from "./components/ChatInput";
import { ColdStart } from "./components/ColdStart";
import { ErrorBanner } from "./components/ErrorBanner";
import { TurnFailure } from "./components/ErrorStates/TurnFailure";
import type { TurnFailureView } from "./components/ErrorStates/TurnFailure";
import { HistoryList } from "./components/HistoryList";
import { MessageList } from "./components/MessageList";
import { WaitingRitual } from "./components/WaitingRitual";
import { currentChatConfig } from "./config";
import { deriveEntryState, resolveRouteReference } from "./entry-state";
import type { ChatEntryState } from "./entry-state";
import { chatDictFor } from "./i18n";
import type { ChatDict } from "./i18n";
import type { ChatSearch } from "./search";
import { useAutoSend } from "./use-auto-send";
import { useBackendHealth } from "./use-backend-health";
import type { BackendHealth } from "./use-backend-health";
import type { ChatSession } from "./use-chat-session";
import { useChatSession } from "./use-chat-session";
import { useConversationHistory } from "./use-conversation-history";
import { useStreamRecovery } from "./use-stream-recovery";
import { useTurnTimeout } from "./use-turn-timeout";
import { useTurnTiming } from "./use-turn-timing";
import type { ConversationHistory } from "./use-conversation-history";

export interface ChatPageProps {
  readonly search: ChatSearch;
}

type ShellProps = Readonly<{
  entry: ChatEntryState;
  dict: ChatDict;
  chat: ChatSession;
  history: ConversationHistory;
  failure: TurnFailureView | undefined;
  onRetry: () => void;
  onSend: (text: string) => void;
}>;

function useScrollAnchor(itemCount: number) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    ref.current?.scrollIntoView({ block: "end" });
  }, [itemCount]);
  return ref;
}

type BodyProps = Omit<ShellProps, "onRetry">;

function showColdStart({ entry, chat, history }: BodyProps): boolean {
  return chat.messages.length === 0 && history.entries.length === 0 && entry !== "A3";
}

function ColdStartGate(props: BodyProps) {
  if (!showColdStart(props)) return null;
  return <ColdStart dict={props.dict} onChip={props.onSend} disabled={props.entry === "A5"} />;
}

function HistoryLoadingGate({ history, dict }: Readonly<{ history: ConversationHistory; dict: ChatDict }>) {
  if (history.status !== "loading") return null;
  return (
    <p className="chat-history-loading" role="status" aria-busy="true">
      {dict.preparing}
    </p>
  );
}

function ChatMessages({ chat, dict }: Readonly<{ chat: ChatSession; dict: ChatDict }>) {
  const settledDurationMs = useTurnTiming(chat.status);
  return <MessageList messages={chat.messages} dict={dict} status={chat.status} settledDurationMs={settledDurationMs} />;
}

function ChatBody(props: BodyProps) {
  const anchor = useScrollAnchor(props.history.entries.length + props.chat.messages.length);
  return (
    <section className="chat-body">
      <HistoryLoadingGate history={props.history} dict={props.dict} />
      <HistoryList entries={props.history.entries} dict={props.dict} />
      <ColdStartGate {...props} /><ChatMessages chat={props.chat} dict={props.dict} /><TurnFailure view={props.failure} dict={props.dict} /><WaitingRitual status={props.chat.status} dict={props.dict} messages={props.chat.messages} /><div ref={anchor} aria-hidden="true" />
    </section>
  );
}

function HistoryErrorGate({ history, dict }: Readonly<{ history: ConversationHistory; dict: ChatDict }>) {
  if (history.status !== "error") return null;
  return <ErrorBanner dict={dict} onRetry={history.retry} message={dict.historyError} />;
}

function isInputLocked(props: ShellProps): boolean {
  const busy = props.chat.status === "submitted" || props.chat.status === "streaming";
  const historyBlocked = props.entry === "A3" && props.history.status !== "success";
  return props.entry === "A5" || busy || historyBlocked;
}

function ChatShell(props: ShellProps) {
  return (
    <main className="chat-page">
      {props.entry === "A5" ? <ErrorBanner dict={props.dict} onRetry={props.onRetry} /> : null}
      <HistoryErrorGate history={props.history} dict={props.dict} />
      <ChatBody {...props} />
      <ChatInput dict={props.dict} disabled={isInputLocked(props)} onSend={props.onSend} />
    </main>
  );
}

/** Send, plus the D6-style retry: drop the failed turn's partial and resubmit. */
function useTurnActions(chat: ChatSession): ChatActions {
  const { sendMessage, clearError, regenerate } = chat;
  const send = useCallback((text: string) => void sendMessage({ text }), [sendMessage]);
  const regen = useCallback(() => { clearError(); void regenerate(); }, [clearError, regenerate]);
  return useMemo(() => ({ send, regenerate: regen }), [send, regen]);
}

function turnFailureSignal(lastStatus: number | undefined): FailureSignal {
  if (lastStatus !== undefined && lastStatus >= 400) return { kind: "http", status: lastStatus };
  return { kind: "stream-abort" };
}

function isActiveTurn(status: ChatSession["status"]): boolean {
  return status === "submitted" || status === "streaming";
}

function turnFailureState(chat: ChatSession, timedOut: boolean): ChatErrorState | undefined {
  if (isActiveTurn(chat.status)) return undefined;
  if (timedOut) return "D5";
  if (chat.error === undefined) return undefined;
  return classifyFailure(turnFailureSignal(chat.lastHttpStatus())) ?? "D4";
}

/** Compose the D4/D5/D8 view: watchdog + classification + P6 recovery. */
function useTurnFailure(chat: ChatSession, baseUrl: string): TurnFailureView | undefined {
  const timeout = useTurnTimeout(chat.status, () => void chat.stop());
  const recovery = useStreamRecovery(baseUrl, chat, chat.sessionIdOf);
  const state = turnFailureState(chat, timeout.timedOut);
  const onRetry = useCallback(() => { timeout.reset(); recovery.recover(); }, [timeout, recovery]);
  const onExpiredResume = useCallback(() => { timeout.reset(); recovery.recoverExpired(); }, [timeout, recovery]);
  if (state === undefined) return undefined;
  return { state, onRetry, onExpiredResume, recovering: recovery.recovering };
}

/** A5 covers backend reachability only; stream failures render inline D-strips. */
function entryStateOf(search: ChatSearch, health: BackendHealth): ChatEntryState {
  return deriveEntryState({
    healthy: health.status !== "down",
    query: search.q,
    sessionId: search.session,
    routeReference: resolveRouteReference(search.route),
  });
}

function useAutoSendFromQuery(search: ChatSearch, health: BackendHealth, send: (text: string) => void) {
  useAutoSend({
    query: search.q,
    enabled: health.healthy && !search.session,
    send,
    sessionId: search.session,
  });
}

function useChatState(search: ChatSearch) {
  const config = useMemo(currentChatConfig, []);
  const health = useBackendHealth(config.baseUrl);
  const chat = useChatSession(config.chatUrl, search.session);
  const history = useConversationHistory(config.baseUrl, search.session);
  return { config, health, chat, history };
}

export function ChatPage({ search }: ChatPageProps) {
  const { config, health, chat, history } = useChatState(search);
  const actions = useTurnActions(chat);
  useAutoSendFromQuery(search, health, actions.send);
  return (
    <ChatActionsProvider actions={actions}>
      <ChatShell entry={entryStateOf(search, health)} dict={chatDictFor(useLocale())} chat={chat} history={history} failure={useTurnFailure(chat, config.baseUrl)} onRetry={health.retry} onSend={actions.send} />
    </ChatActionsProvider>
  );
}
