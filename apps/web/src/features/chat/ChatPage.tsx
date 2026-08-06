import { useCallback, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useLocale } from "../../i18n/LocaleProvider";
import type { Locale } from "../../i18n/locales";
import { useAuthStatus } from "../../lib/auth/session";
import { ChatActionsProvider, sendWithOriginOf } from "./ChatActions";
import type { ChatActions } from "./ChatActions";
import { ByokPanelGate, ChallengeGate, ChatIntro, ChatNotices, ChatShell, DepartureGate, DockTray, ScrollAnchor, TurnStream } from "./components/ChatShell";
import { ChatInput } from "./components/ChatInput";
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
import { useTurnstileChallenge, useTurnstileReady } from "./use-turnstile-challenge";
import type { TurnstileChallenge } from "./use-turnstile-challenge";
import { ChatReturnTargetProvider } from "./ChatReturnTarget";

export interface ChatPageProps {
  readonly search: ChatSearch;
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

/** Turnstile challenge + auth-gated tray state (D12 lock, failures). */
function useGuardedTray(chat: ChatSession, baseUrl: string, auth: ReturnType<typeof useAuthStatus>, sessionKey: string | undefined) {
  const challenge = useTurnstileChallenge(chat);
  const tray = useTrayState(chat, baseUrl, { challenged: challenge !== undefined, auth }, sessionKey);
  return { challenge, tray };
}

function useChatPage(search: ChatSearch) {
  const { config, health, chat, history } = useChatState(search);
  const { actions: live, gps } = useOriginTracking(useTurnActions(chat));
  const auth = useAuthStatus();
  // `?q=` must not fire before the widget has a token to send (#447 review).
  const { challenge, tray } = useGuardedTray(chat, config.baseUrl, auth, search.session);
  const actions = useLockedActions(live, tray.quota.locked);
  const surfaces = usePageSurfaces(chat, actions, gps);
  useAutoSendFromQuery(search, health, actions.send, useTurnstileReady(challenge !== undefined));
  return { config, health, chat, history, actions, challenge, byok: useByokPanel(search, auth), ...surfaces, ...tray };
}

type PageState = ReturnType<typeof useChatPage>;

/** A5 soft-lock, busy turns, and the A3 history gate all lock the composer. */
function isInputLocked(entry: ChatEntryState, chat: ChatSession, history: ConversationHistory): boolean {
  const busy = chat.status === "submitted" || chat.status === "streaming";
  const historyBlocked = entry === "A3" && history.status !== "success";
  return entry === "A5" || busy || historyBlocked;
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

/** Plain page-level assembly: the BYOK panel, the input, the Turnstile hint. */
function chatComposer(dict: ChatDict, baseUrl: string, byok: ByokPanel, challenge: TurnstileChallenge | undefined, quota: QuotaLock, onSend: (text: string) => void, disabled: boolean): ReactNode {
  return (
    <>
      <ByokPanelGate dict={dict} baseUrl={baseUrl} byok={byok} />
      <ChatInput dict={dict} disabled={disabled} quotaLocked={quota.locked} onSend={onSend} settingsOpen={byok.open} onToggleSettings={byok.toggle} />
      <ChallengeGate dict={dict} challenge={challenge} />
    </>
  );
}

function ChatPageView({ search, page }: Readonly<{ search: ChatSearch; page: PageState }>) {
  const entry = entryStateOf(search, page.health);
  return <ChatShell
    notices={<ChatNotices entry={entry} onRetry={page.health.retry} history={page.history} dict={page.dict} />}
    body={chatBody(entry, page.chat, page.history, page.dict, page.departure.onSend, page.failure, page.locale, page.byok)}
    dock={chatDock(page.departure, page.dict, page.config.baseUrl, page.photo, page.chat, page.recompute)}
    composer={chatComposer(page.dict, page.config.baseUrl, page.byok, page.challenge, page.quota, page.departure.onSend, isInputLocked(entry, page.chat, page.history))}
  />;
}

/** Publishes the live session id so every in-chat login wall can send the
 * visitor back to this conversation after signing in (#507 review P1-1). */
function withReturnTarget(search: ChatSearch, page: PageState) {
  return (
    <ChatReturnTargetProvider sessionIdOf={page.chat.sessionIdOf}>
      <ChatPageView search={search} page={page} />
    </ChatReturnTargetProvider>
  );
}

export function ChatPage({ search }: ChatPageProps) {
  const page = useChatPage(search);
  return (
    <SpotSelectionProvider selection={page.selection}>
      <ChatActionsProvider actions={page.actions}>{withReturnTarget(search, page)}</ChatActionsProvider>
    </SpotSelectionProvider>
  );
}
