import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocale } from "../../i18n/context";
import { classifyFailure } from "../../lib/chat/errorClassifier";
import type { ChatErrorState, FailureSignal } from "../../lib/chat/errorClassifier";
import { ChatActionsProvider } from "./chat-actions";
import type { ChatActions } from "./chat-actions";
import { ChatInput } from "./components/ChatInput";
import { ColdStart } from "./components/ColdStart";
import { DeparturePrompt } from "./components/DeparturePrompt";
import { PhotoSearchUpload } from "./components/PhotoSearchUpload";
import { ErrorBanner } from "./components/ErrorBanner";
import { SelectionTray } from "./components/SelectionTray";
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
import type { PhotoGps } from "./photo-search";
import type { ChatSearch } from "./search";
import { SpotSelectionProvider, useSpotSelectionState } from "./selection/useSpotSelection";
import { useRecomputeTurn } from "./selection/useRecomputeTurn";
import type { RecomputeTurn } from "./selection/useRecomputeTurn";
import { useAutoSend } from "./use-auto-send";
import { useDeparturePrompt } from "./use-departure-prompt";
import type { DeparturePromptState } from "./use-departure-prompt";
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
  recompute: RecomputeTurn;
  onRetry: () => void;
  onSend: (text: string) => void;
  departure: DeparturePromptState;
  baseUrl: string;
  gps: PhotoGps | undefined;
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

/** P1-3: the tray must not fire while ANY turn is in flight — the AI SDK's
 * `makeRequest` has no concurrency guard, so a mid-stream tap would clobber
 * the active response. Chat busy always reads as `busy` here. */
function trayStatus(chat: ChatSession, recompute: RecomputeTurn): RecomputeTurn["status"] {
  const active = chat.status === "submitted" || chat.status === "streaming";
  return active ? "busy" : recompute.status;
}

type TrayHostProps = Readonly<{ dict: ChatDict; chat: ChatSession; recompute: RecomputeTurn }>;

/** The E2 recompute bar docks above the composer (design `.dock`); the live
 * region keeps announcing after the bar unmounts on fire (a11y handoff). */
function RecomputeTray({ dict, chat, recompute }: TrayHostProps) {
  const status = trayStatus(chat, recompute);
  return (
    <>
      <span className="chat-live-note" aria-live="polite">{status === "busy" ? dict.preparing : ""}</span>
      <SelectionTray dict={dict} status={status} lastSentIds={recompute.lastSentIds} onRecompute={recompute.fire} />
    </>
  );
}

/** C2t chips render only while a route request is held for departure info. */
function DepartureGate({ departure, dict }: Readonly<{ departure: DeparturePromptState; dict: ChatDict }>) {
  if (departure.pending === null) return null;
  return (
    <DeparturePrompt dict={dict} onChip={departure.onChip} onLocated={departure.onLocated} onManualLocation={departure.onManualLocation} />
  );
}

function ShellNotices(props: ShellProps) {
  return (
    <>
      {props.entry === "A5" ? <ErrorBanner dict={props.dict} onRetry={props.onRetry} /> : null}
      <HistoryErrorGate history={props.history} dict={props.dict} />
    </>
  );
}

/** The C2t chips and photo upload sit between the stream and the composer. */
function ComposerExtras(props: ShellProps) {
  return (
    <>
      <DepartureGate departure={props.departure} dict={props.dict} />
      <PhotoSearchUpload dict={props.dict} baseUrl={props.baseUrl} gps={props.gps} />
    </>
  );
}

function ChatShell(props: ShellProps) {
  return (
    <main className="chat-page">
      <ShellNotices {...props} />
      <ChatBody {...props} />
      <ComposerExtras {...props} />
      <RecomputeTray dict={props.dict} chat={props.chat} recompute={props.recompute} />
      <ChatInput dict={props.dict} disabled={isInputLocked(props)} onSend={props.onSend} />
    </main>
  );
}

/** Send, plus the D6-style retry: drop the failed turn's partial and resubmit. */
function useTurnActions(chat: ChatSession): ChatActions {
  const { sendMessage, clearError, regenerate } = chat;
  const send = useCallback((text: string) => void sendMessage({ text }), [sendMessage]);
  const sendWithOrigin = useCallback((text: string, lat: number, lng: number) => {
    void sendMessage({ text }, { body: { origin_lat: lat, origin_lng: lng } });
  }, [sendMessage]);
  const regen = useCallback(() => { clearError(); void regenerate(); }, [clearError, regenerate]);
  return useMemo(() => ({ send, regenerate: regen, sendWithOrigin }), [send, regen, sendWithOrigin]);
}

function makeTracked(actions: ChatActions, setGps: (gps: PhotoGps) => void): ChatActions {
  return {
    ...actions,
    sendWithOrigin: (text: string, lat: number, lng: number) => {
      setGps({ lat, lng });
      actions.sendWithOrigin?.(text, lat, lng);
    },
  };
}

/** Remember granted C4 coordinates so photo search can reuse them (AC6). */
function useOriginTracking(actions: ChatActions): { actions: ChatActions; gps: PhotoGps | undefined } {
  const [gps, setGps] = useState<PhotoGps | undefined>(undefined);
  const tracked = useMemo(() => makeTracked(actions, setGps), [actions]);
  return { actions: tracked, gps };
}

function turnFailureSignal(lastStatus: number | undefined, code: string | undefined): FailureSignal {
  if (lastStatus !== undefined && lastStatus >= 400) return { kind: "http", status: lastStatus, code };
  return { kind: "stream-abort" };
}

function isActiveTurn(status: ChatSession["status"]): boolean {
  return status === "submitted" || status === "streaming";
}

function turnFailureState(chat: ChatSession, timedOut: boolean): ChatErrorState | undefined {
  if (isActiveTurn(chat.status)) return undefined;
  if (timedOut) return "D5";
  if (chat.error === undefined) return undefined;
  return classifyFailure(turnFailureSignal(chat.lastHttpStatus(), chat.lastErrorCode())) ?? "D4";
}

/** Compose the D4/D5/D8/D11 view: watchdog + classification + P6 recovery. */
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

/** A failed recompute retries inline on the tray, never as a full-page D-state. */
function maskRecomputeFailure(recompute: RecomputeTurn, failure: TurnFailureView | undefined): TurnFailureView | undefined {
  return recompute.status === "failed" ? undefined : failure;
}

function useChatPage(search: ChatSearch) {
  const { config, health, chat, history } = useChatState(search);
  const { actions, gps } = useOriginTracking(useTurnActions(chat));
  const dict = chatDictFor(useLocale());
  const departure = useDeparturePrompt(actions, dict);
  const recompute = useRecomputeTurn(chat);
  const failure = maskRecomputeFailure(recompute, useTurnFailure(chat, config.baseUrl));
  const selection = useSpotSelectionState();
  useAutoSendFromQuery(search, health, actions.send);
  return { config, health, chat, history, actions, gps, dict, departure, recompute, failure, selection };
}

type PageState = ReturnType<typeof useChatPage>;

function ChatPageView({ search, page }: Readonly<{ search: ChatSearch; page: PageState }>) {
  return (
    <ChatShell entry={entryStateOf(search, page.health)} dict={page.dict} chat={page.chat} history={page.history} failure={page.failure} recompute={page.recompute} onRetry={page.health.retry} onSend={page.departure.onSend} departure={page.departure} baseUrl={page.config.baseUrl} gps={page.gps} />
  );
}

export function ChatPage({ search }: ChatPageProps) {
  const page = useChatPage(search);
  return (
    <SpotSelectionProvider selection={page.selection}>
      <ChatActionsProvider actions={page.actions}>
        <ChatPageView search={search} page={page} />
      </ChatActionsProvider>
    </SpotSelectionProvider>
  );
}
