import { useCallback, useMemo, useState } from "react";
import { useLocale } from "../../i18n/context";
import { useAuthStatus } from "../../lib/auth/session";
import { ChatActionsProvider, sendWithOriginOf } from "./chat-actions";
import type { ChatActions } from "./chat-actions";
import { ChatShell } from "./components/ChatShell";
import { currentChatConfig } from "./config";
import { deriveEntryState, resolveRouteReference } from "./entry-state";
import type { ChatEntryState } from "./entry-state";
import { chatDictFor } from "./i18n";
import type { PhotoGps, PhotoSearchContext } from "./photo-search";
import type { ChatSearch } from "./search";
import { SpotSelectionProvider, useSpotSelectionState } from "./selection/useSpotSelection";
import { useRecomputeTurn } from "./selection/useRecomputeTurn";
import { lockedRecompute, useLockedActions } from "./quota-lock";
import { useAutoSend } from "./use-auto-send";
import { useByokPanel } from "./use-byok-panel";
import { useDeparturePrompt } from "./use-departure-prompt";
import { useBackendHealth } from "./use-backend-health";
import type { BackendHealth } from "./use-backend-health";
import type { ChatSession } from "./use-chat-session";
import { useChatSession } from "./use-chat-session";
import { useConversationHistory } from "./use-conversation-history";
import { maskRecomputeFailure, useTurnFailure } from "./use-turn-failure";
import type { TurnFailureGate } from "./use-turn-failure";
import { useTurnstileChallenge, useTurnstileReady } from "./use-turnstile-challenge";
import { ChatReturnTargetProvider } from "./return-target";

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

function ChatPageView({ search, page }: Readonly<{ search: ChatSearch; page: PageState }>) {
  return (
    <ChatShell entry={entryStateOf(search, page.health)} dict={page.dict} chat={page.chat} history={page.history} failure={page.failure} recompute={page.recompute} challenge={page.challenge} onRetry={page.health.retry} onSend={page.departure.onSend} departure={page.departure} baseUrl={page.config.baseUrl} photo={page.photo} quota={page.quota} locale={page.locale} byok={page.byok} />
  );
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
