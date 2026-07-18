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
import type { ChatSession } from "./use-chat-session";
import { useChatSession } from "./use-chat-session";
import { useConversationHistory } from "./use-conversation-history";
import type { HistoryEntry } from "./use-conversation-history";

export interface ChatPageProps {
  readonly search: ChatSearch;
}

type ShellProps = Readonly<{
  entry: ChatEntryState;
  dict: ChatDict;
  chat: ChatSession;
  history: readonly HistoryEntry[];
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
  return chat.messages.length === 0 && history.length === 0 && entry !== "A3";
}

function ColdStartGate(props: BodyProps) {
  if (!showColdStart(props)) return null;
  return <ColdStart dict={props.dict} onChip={props.onSend} disabled={props.entry === "A5"} />;
}

function ChatBody(props: BodyProps) {
  const anchor = useScrollAnchor(props.history.length + props.chat.messages.length);
  return (
    <section className="chat-body">
      <HistoryList entries={props.history} dict={props.dict} />
      <ColdStartGate {...props} /><MessageList messages={props.chat.messages} dict={props.dict} />
      <div ref={anchor} aria-hidden="true" />
    </section>
  );
}

function ChatShell(props: ShellProps) {
  const busy = props.chat.status === "submitted" || props.chat.status === "streaming";
  return (
    <main className="chat-page">
      {props.entry === "A5" ? <ErrorBanner dict={props.dict} onRetry={props.onRetry} /> : null}
      <ChatBody {...props} />
      <ChatInput dict={props.dict} disabled={props.entry === "A5" || busy} onSend={props.onSend} />
    </main>
  );
}

function useSendText(chat: ChatSession): (text: string) => void {
  const { sendMessage } = chat;
  return useCallback((text: string) => void sendMessage({ text }), [sendMessage]);
}

function useRetry(chat: ChatSession, retryHealth: () => void): () => void {
  const { clearError } = chat;
  return useCallback(() => {
    clearError();
    retryHealth();
  }, [clearError, retryHealth]);
}

function entryStateOf(search: ChatSearch, healthy: boolean, chat: ChatSession): ChatEntryState {
  return deriveEntryState({
    healthy: healthy && chat.error === undefined,
    query: search.q,
    sessionId: search.session,
    routeReference: resolveRouteReference(search.route),
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
  useAutoSend(search.q, health.healthy && !search.session, onSend);
  const entry = entryStateOf(search, health.healthy, chat);
  const onRetry = useRetry(chat, health.retry);
  return <ChatShell entry={entry} dict={chatDictFor(useLocale())} chat={chat} history={history} onRetry={onRetry} onSend={onSend} />;
}
