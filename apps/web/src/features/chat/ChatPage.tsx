import { useCallback, useEffect, useMemo, useRef } from "react";
import { useLocale } from "../../i18n/context";
import { ChatInput } from "./components/ChatInput";
import { ColdStart } from "./components/ColdStart";
import { ErrorBanner } from "./components/ErrorBanner";
import { HistoryList } from "./components/HistoryList";
import { MessageList } from "./components/MessageList";
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
import type { ConversationHistory } from "./use-conversation-history";

export interface ChatPageProps {
  readonly search: ChatSearch;
}

type ShellProps = Readonly<{
  entry: ChatEntryState;
  dict: ChatDict;
  chat: ChatSession;
  history: ConversationHistory;
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

function ChatBody(props: BodyProps) {
  const anchor = useScrollAnchor(props.history.entries.length + props.chat.messages.length);
  return (
    <section className="chat-body">
      <HistoryLoadingGate history={props.history} dict={props.dict} />
      <HistoryList entries={props.history.entries} dict={props.dict} />
      <ColdStartGate {...props} /><MessageList messages={props.chat.messages} dict={props.dict} /><div ref={anchor} aria-hidden="true" />
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

function useSendText(chat: ChatSession): (text: string) => void {
  const { sendMessage } = chat;
  return useCallback((text: string) => void sendMessage({ text }), [sendMessage]);
}

/**
 * A5 retry distinguishes the two failure sources: a failed healthz probe is
 * re-probed, while a failed stream turn is regenerated (the AI SDK drops the
 * partial assistant message and resubmits the turn).
 */
function useRetry(chat: ChatSession, retryHealth: () => void): () => void {
  const { error, clearError, regenerate } = chat;
  return useCallback(() => {
    retryHealth();
    if (!error) return;
    clearError();
    void regenerate();
  }, [error, clearError, regenerate, retryHealth]);
}

function entryStateOf(search: ChatSearch, health: BackendHealth, chat: ChatSession): ChatEntryState {
  return deriveEntryState({
    healthy: health.status !== "down" && chat.error === undefined,
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
  return { health, chat, history };
}

export function ChatPage({ search }: ChatPageProps) {
  const { health, chat, history } = useChatState(search);
  const onSend = useSendText(chat);
  useAutoSendFromQuery(search, health, onSend);
  const entry = entryStateOf(search, health, chat);
  const onRetry = useRetry(chat, health.retry);
  return <ChatShell entry={entry} dict={chatDictFor(useLocale())} chat={chat} history={history} onRetry={onRetry} onSend={onSend} />;
}
