import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TurnstileGate } from "../../components/TurnstileGate";
import { useLocale } from "../../i18n/context";
import type { Locale } from "../../i18n/locales";
import { useAuthStatus } from "../../lib/auth/session";
import { ChatActionsProvider } from "./chat-actions";
import type { ChatActions } from "./chat-actions";
import { ByokSettings } from "./components/ByokSettings";
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
import type { PhotoGps, PhotoSearchContext } from "./photo-search";
import type { ChatSearch } from "./search";
import { SpotSelectionProvider, useSpotSelectionState } from "./selection/useSpotSelection";
import { useRecomputeTurn } from "./selection/useRecomputeTurn";
import type { RecomputeTurn } from "./selection/useRecomputeTurn";
import { lockedRecompute, useLockedActions } from "./quota-lock";
import type { QuotaLock } from "./quota-lock";
import { useAutoSend } from "./use-auto-send";
import { useByokPanel } from "./use-byok-panel";
import type { ByokPanel } from "./use-byok-panel";
import { useDeparturePrompt } from "./use-departure-prompt";
import type { DeparturePromptState } from "./use-departure-prompt";
import { useBackendHealth } from "./use-backend-health";
import type { BackendHealth } from "./use-backend-health";
import type { ChatSession } from "./use-chat-session";
import { useChatSession } from "./use-chat-session";
import { useConversationHistory } from "./use-conversation-history";
import { maskRecomputeFailure, useTurnFailure } from "./use-turn-failure";
import type { TurnFailureGate } from "./use-turn-failure";
import { useTurnTiming } from "./use-turn-timing";
import { useTurnstileChallenge, useTurnstileReady } from "./use-turnstile-challenge";
import type { TurnstileChallenge } from "./use-turnstile-challenge";
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
  challenge: TurnstileChallenge | undefined;
  onRetry: () => void;
  onSend: (text: string) => void;
  departure: DeparturePromptState;
  baseUrl: string;
  photo: PhotoSearchContext;
  quota: QuotaLock;
  locale: Locale;
  byok: ByokPanel;
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
      <ColdStartGate {...props} /><ChatMessages chat={props.chat} dict={props.dict} /><TurnFailure view={props.failure} dict={props.dict} locale={props.locale} onOpenSettings={props.byok.show} /><WaitingRitual status={props.chat.status} dict={props.dict} messages={props.chat.messages} /><div ref={anchor} aria-hidden="true" />
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
      <PhotoSearchUpload dict={props.dict} baseUrl={props.baseUrl} context={props.photo} />
    </>
  );
}

/** The dock's hint slot: silent until Turnstile decides a human check is due. */
function ChallengeGate({ dict, challenge }: Readonly<{ dict: ChatDict; challenge: TurnstileChallenge | undefined }>) {
  if (challenge === undefined) return null;
  return <TurnstileGate dict={dict} {...challenge} />;
}

/** Chips, photo upload, and the E2 tray dock between the stream and composer. */
function ComposerDock(props: ShellProps) {
  return (
    <>
      <ComposerExtras {...props} />
      <RecomputeTray dict={props.dict} chat={props.chat} recompute={props.recompute} />
    </>
  );
}

/** The BYOK settings panel docks above the composer when toggled open (#284 T6). */
function ByokPanelGate({ dict, baseUrl, byok }: Readonly<{ dict: ChatDict; baseUrl: string; byok: ByokPanel }>) {
  if (!byok.open) return null;
  return <ByokSettings dict={dict} auth={byok.auth} baseUrl={baseUrl} />;
}

/** Composer plus the quiet challenge slot beneath it (design sync `.hint`). */
function Composer(props: ShellProps) {
  return (
    <>
      <ByokPanelGate dict={props.dict} baseUrl={props.baseUrl} byok={props.byok} />
      <ChatInput dict={props.dict} disabled={isInputLocked(props)} quotaLocked={props.quota.locked} onSend={props.onSend} settingsOpen={props.byok.open} onToggleSettings={props.byok.toggle} />
      <ChallengeGate dict={props.dict} challenge={props.challenge} />
    </>
  );
}

function ChatShell(props: ShellProps) {
  return (
    <main className="chat-page">
      <ShellNotices {...props} />
      <ChatBody {...props} />
      <ComposerDock {...props} />
      <Composer {...props} />
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

/** A5 covers backend reachability only; stream failures render inline D-strips. */
function entryStateOf(search: ChatSearch, health: BackendHealth): ChatEntryState {
  return deriveEntryState({
    healthy: health.status !== "down",
    query: search.q,
    sessionId: search.session,
    routeReference: resolveRouteReference(search.route),
  });
}

function useAutoSendFromQuery(
  search: ChatSearch, health: BackendHealth, send: (text: string) => void, ready: boolean,
) {
  useAutoSend({
    query: search.q,
    enabled: health.healthy && ready && !search.session,
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

/** Photo requests share chat's identity: locale, live session id, C4 gps. */
function usePhotoContext(locale: ReturnType<typeof useLocale>, chat: ChatSession, gps: PhotoGps | undefined): PhotoSearchContext {
  return useMemo(
    () => ({ locale, sessionIdOf: chat.sessionIdOf, gps }),
    [locale, chat.sessionIdOf, gps],
  );
}

/** Tray state: the recompute turn, its masked failure, and the spot store. */
function useTrayState(chat: ChatSession, baseUrl: string, gate: TurnFailureGate) {
  const turn = useTurnFailure(chat, baseUrl, gate);
  const recompute = useRecomputeTurn(chat);
  const failure = maskRecomputeFailure(recompute, turn.view);
  const selection = useSpotSelectionState();
  return { recompute: lockedRecompute(recompute, turn.quota.locked), failure, selection, quota: turn.quota };
}

/** Locale-bound page copy plus the photo/departure surfaces that share it. */
function usePageSurfaces(chat: ChatSession, actions: ChatActions, gps: PhotoGps | undefined) {
  const locale = useLocale();
  const dict = chatDictFor(locale);
  const photo = usePhotoContext(locale, chat, gps);
  const departure = useDeparturePrompt(actions, dict);
  return { dict, photo, departure, locale };
}

/** Turnstile challenge + auth-gated tray state (D12 lock, failures). */
function useGuardedTray(chat: ChatSession, baseUrl: string, auth: ReturnType<typeof useAuthStatus>) {
  const challenge = useTurnstileChallenge(chat);
  const tray = useTrayState(chat, baseUrl, { challenged: challenge !== undefined, auth });
  return { challenge, tray };
}

function useChatPage(search: ChatSearch) {
  const { config, health, chat, history } = useChatState(search);
  const { actions: live, gps } = useOriginTracking(useTurnActions(chat));
  const auth = useAuthStatus();
  // `?q=` must not fire before the widget has a token to send (#447 review).
  const { challenge, tray } = useGuardedTray(chat, config.baseUrl, auth);
  const actions = useLockedActions(live, tray.quota.locked);
  const surfaces = usePageSurfaces(chat, actions, gps);
  useAutoSendFromQuery(search, health, actions.send, useTurnstileReady(challenge !== undefined));
  return { config, health, chat, history, actions, challenge, byok: useByokPanel(search, auth), ...surfaces, ...tray };
}

type PageState = ReturnType<typeof useChatPage>;

function ChatPageView({ search, page }: Readonly<{ search: ChatSearch; page: PageState }>) {
  return (
    <ChatShell entry={entryStateOf(search, page.health)} dict={page.dict} chat={page.chat} history={page.history} failure={page.failure} recompute={page.recompute} challenge={page.challenge} onRetry={page.health.retry} onSend={page.departure.onSend} departure={page.departure} baseUrl={page.config.baseUrl} photo={page.photo} quota={page.quota} locale={page.locale} byok={page.byok} />
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
