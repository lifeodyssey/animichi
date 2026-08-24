import { useCallback, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useLocale } from "../../i18n/LocaleProvider";
import type { Locale } from "../../i18n/locales";
import { useAuthStatus } from "../../lib/auth/session";
import { ChatActionsProvider, sendWithOriginOf } from "./ChatActions";
import type { ChatActions } from "./ChatActions";
import { ChatIntro, ChatNotices, ChatShell, DepartureGate, DockTray, ScrollAnchor, TurnStream } from "./components/ChatShell";
import { ByokSettings } from "./components/ByokSettings";
import type { PanelPreferences } from "./components/ByokSettings";
import { ChatInput } from "./components/ChatInput";
import { ChatAppBar } from "./components/ChatAppBar";
import { ChatSettingsDrawer } from "./components/ChatSettingsDrawer";
import { currentChatConfig } from "./config";
import { deriveEntryState, resolveRouteReference } from "./entry-state";
import type { ChatEntryState } from "./entry-state";
import { chatDictFor } from "./i18n";
import type { ChatDict } from "./i18n";
import type { PhotoGps, PhotoSearchContext } from "./photo-search";
import type { ChatSearch } from "./search";
import { SpotSelectionProvider, useSpotSelectionState } from "./selection/use-spot-selection";
import { useRecomputeTurn } from "./selection/use-recompute-turn";
import type { RecomputeTurn } from "./selection/use-recompute-turn";
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
import type { ConversationHistory } from "./use-conversation-history";
import { maskRecomputeFailure, useTurnFailure } from "./use-turn-failure";
import type { TurnFailureGate } from "./use-turn-failure";
import type { TurnFailureView } from "./components/ErrorStates/TurnFailure";
import { ChatReturnTargetProvider } from "./ChatReturnTarget";
import { useAgentWarmup } from "../../lib/agent-warmup";

export interface ChatPageProps {
  readonly search: ChatSearch;
  /** The settings drawer's app-preference section, composed by the route. */
  readonly preferences?: PanelPreferences;
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
      sendWithOriginOf(actions)(text, lat, lng);
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

/** Photo requests share chat's identity: locale, live session id, C4 gps. */
function usePhotoContext(locale: ReturnType<typeof useLocale>, chat: ChatSession, gps: PhotoGps | undefined): PhotoSearchContext {
  return useMemo(
    () => ({ locale, sessionIdOf: chat.sessionIdOf, gps }),
    [locale, chat.sessionIdOf, gps],
  );
}

/** Tray state: the recompute turn, its masked failure, and the spot store. */
function useTrayState(chat: ChatSession, baseUrl: string, gate: TurnFailureGate, sessionKey: string | undefined) {
  const turn = useTurnFailure(chat, baseUrl, gate);
  const recompute = useRecomputeTurn(chat, sessionKey);
  const failure = maskRecomputeFailure(recompute, turn.view);
  const selection = useSpotSelectionState(sessionKey);
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

function useGuardedTray(chat: ChatSession, baseUrl: string, auth: ReturnType<typeof useAuthStatus>, sessionKey: string | undefined) {
  return useTrayState(chat, baseUrl, { challenged: false, auth }, sessionKey);
}

function useChatPage(search: ChatSearch) {
  const { config, health, chat, history } = useChatState(search);
  const { actions: live, gps } = useOriginTracking(useTurnActions(chat));
  const auth = useAuthStatus();
  const tray = useGuardedTray(chat, config.baseUrl, auth, search.session);
  const actions = useLockedActions(live, tray.quota.locked);
  const surfaces = usePageSurfaces(chat, actions, gps);
  useAutoSendFromQuery(search, health, actions.send);
  return { config, health, chat, history, actions, auth, byok: useByokPanel(search, auth), ...surfaces, ...tray };
}

type PageState = ReturnType<typeof useChatPage>;

/** What the composer is allowed to do this render (spec group G): A5 and the
 * A3 history gate take the field away, a running turn only takes the send key,
 * and a failed turn owes the visitor their words back. */
export type ComposerGate = Readonly<{ locked: boolean; busy: boolean; failed: boolean }>;

function composerGateOf(entry: ChatEntryState, chat: ChatSession, history: ConversationHistory, failure: TurnFailureView | undefined): ComposerGate {
  const historyBlocked = entry === "A3" && history.status !== "success";
  return {
    locked: entry === "A5" || historyBlocked,
    busy: chat.status === "submitted" || chat.status === "streaming",
    failed: failure !== undefined,
  };
}

/** Plain page-level assembly (not a component): the `.chat-body` order spans
 * three regions whose state union exceeds the component prop ceiling. */
function chatBody(entry: ChatEntryState, chat: ChatSession, history: ConversationHistory, dict: ChatDict, onSend: (text: string) => void, failure: TurnFailureView | undefined, locale: Locale, byok: ByokPanel): ReactNode {
  return (
    <>
      <ChatIntro entry={entry} chat={chat} history={history} dict={dict} onSend={onSend} />
      <TurnStream chat={chat} dict={dict} failure={failure} locale={locale} byok={byok} />
      <ScrollAnchor count={history.entries.length + chat.messages.length} />
    </>
  );
}

/** Plain page-level assembly: the departure chips and the dock surfaces. */
function chatDock(departure: DeparturePromptState, dict: ChatDict, baseUrl: string, photo: PhotoSearchContext, chat: ChatSession, recompute: RecomputeTurn): ReactNode {
  return (
    <>
      <DepartureGate departure={departure} dict={dict} />
      <DockTray dict={dict} baseUrl={baseUrl} photo={photo} chat={chat} recompute={recompute} />
    </>
  );
}

/** Plain page-level assembly: the input and its current send gate. */
function chatComposer(dict: ChatDict, quota: QuotaLock, onSend: (text: string) => void, gate: ComposerGate): ReactNode {
  return <ChatInput dict={dict} disabled={gate.locked} busy={gate.busy} sendFailed={gate.failed} quotaLocked={quota.locked} onSend={onSend} />;
}

function settingsOf(page: PageState, preferences: PanelPreferences | undefined): ReactNode {
  const label = preferences?.label ?? page.dict.byok.settingsToggle;
  return (
    <ChatSettingsDrawer open={page.byok.open} label={label} onToggle={page.byok.toggle} onClose={page.byok.hide}>
      <ByokSettings dict={page.dict} auth={page.byok.auth} baseUrl={page.config.baseUrl} preferences={preferences} />
    </ChatSettingsDrawer>
  );
}

function ChatPageView({ search, page, preferences }: Readonly<{ search: ChatSearch; page: PageState; preferences: PanelPreferences | undefined }>) {
  const entry = entryStateOf(search, page.health);
  return <ChatShell
    appbar={<ChatAppBar dict={page.dict} status={page.auth} settings={settingsOf(page, preferences)} />}
    notices={<ChatNotices entry={entry} onRetry={page.health.retry} history={page.history} dict={page.dict} />}
    body={chatBody(entry, page.chat, page.history, page.dict, page.departure.onSend, page.failure, page.locale, page.byok)}
    dock={chatDock(page.departure, page.dict, page.config.baseUrl, page.photo, page.chat, page.recompute)}
    composer={chatComposer(page.dict, page.quota, page.departure.onSend, composerGateOf(entry, page.chat, page.history, page.failure))}
  />;
}

/** Publishes the live session id so every in-chat login wall can send the
 * visitor back to this conversation after signing in (#507 review P1-1). */
function withReturnTarget(props: ChatPageProps, page: PageState) {
  return (
    <ChatReturnTargetProvider sessionIdOf={page.chat.sessionIdOf}>
      <ChatPageView search={props.search} page={page} preferences={props.preferences} />
    </ChatReturnTargetProvider>
  );
}

export function ChatPage(props: ChatPageProps) {
  useAgentWarmup();
  const page = useChatPage(props.search);
  return (
    <SpotSelectionProvider selection={page.selection}>
      <ChatActionsProvider actions={page.actions}>{withReturnTarget(props, page)}</ChatActionsProvider>
    </SpotSelectionProvider>
  );
}
