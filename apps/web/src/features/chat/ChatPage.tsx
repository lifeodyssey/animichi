import { useCallback, useMemo } from "react";
import type { ReactNode } from "react";
import { useLocale } from "../../i18n/LocaleProvider";
import type { Locale } from "../../i18n/locales";
import { useAuthStatus } from "../../lib/auth/session";
import { ChatActionsProvider } from "./ChatActions";
import type { ChatActions } from "./ChatActions";
import { ChatIntro, ChatNotices, ChatShell, DepartureGate, DockTray, ScrollAnchor, TurnStream } from "./components/ChatShell";
import { ChatAppBar } from "./components/ChatAppBar";
import { ChatHeader } from "./components/ChatHeader";
import { ChatSidebar } from "./components/ChatSidebar";
import { ComposerDock } from "./components/ComposerDock";
import type { ComposerGate } from "./components/ComposerDock";
import { currentChatConfig } from "./config";
import { deriveEntryState, resolveRouteReference } from "./entry-state";
import type { ChatEntryState } from "./entry-state";
import { chatDictFor } from "./i18n";
import type { ChatDict } from "./i18n";
import type { ChatSearch } from "./search";
import { SpotSelectionProvider, useSpotSelectionState } from "./selection/use-spot-selection";
import { ClarifyPickProvider, useClarifyPickState } from "./selection/use-clarify-pick";
import type { ClarifyPickTurn } from "./selection/use-clarify-pick";
import { useRecomputeTurn } from "./selection/use-recompute-turn";
import type { RecomputeTurn } from "./selection/use-recompute-turn";
import { gatedTurnEntry, isTurnActive } from "./lib/turn-gate";
import { journeyTitle } from "./lib/journey-title";
import { lockedClarifyPick, lockedRecompute, useLockedActions } from "./quota-lock";
import type { QuotaLock } from "./quota-lock";
import { useAutoSend } from "./use-auto-send";
import { useDeparturePrompt } from "./use-departure-prompt";
import type { DeparturePromptState } from "./use-departure-prompt";
import { useBackendHealth } from "./use-backend-health";
import type { BackendHealth } from "./use-backend-health";
import type { ChatSession } from "./use-chat-session";
import { useChatSession } from "./use-chat-session";
import { snapshotOperationId, useConversationHistory, withoutSnapshotAssistant } from "./use-conversation-history";
import type { ConversationHistory } from "./use-conversation-history";
import { maskRecomputeFailure, useTurnFailure } from "./use-turn-failure";
import type { TurnFailureGate } from "./use-turn-failure";
import type { TurnFailureView } from "./components/ErrorStates/TurnFailure";
import { ChatReturnTargetProvider } from "./ChatReturnTarget";
import { assignedSessionId, usePublishSessionId } from "./conversation-address";
import { useHeroHistoryRefetch, useHeroResend, useHeroSend, useHeroSession, usePublishMintedSession } from "./hero-session";
import type { HeroSession } from "./hero-session";

export interface ChatPageProps {
  readonly search: ChatSearch;
}

/** The shared status gate (W1 #1220) applied to the text entry points: a
 * send fired while a turn is in flight is dropped, never raced. */
function useGatedSends(chat: ChatSession) {
  const { sendMessage, status } = chat;
  const send = useMemo(() => gatedTurnEntry(status, (text: string) => {
    void sendMessage({ text });
  }), [sendMessage, status]);
  const sendWithOrigin = useMemo(() => gatedTurnEntry(status, (text: string, lat: number, lng: number) => {
    void sendMessage({ text }, { body: { origin_lat: lat, origin_lng: lng } });
  }), [sendMessage, status]);
  return { send, sendWithOrigin };
}

/** Send, plus the D6-style retry: drop the failed turn's partial and resubmit. */
function useTurnActions(chat: ChatSession): ChatActions {
  const { clearError, regenerate } = chat;
  const { send, sendWithOrigin } = useGatedSends(chat);
  const regen = useCallback(() => { clearError(); void regenerate(); }, [clearError, regenerate]);
  const disabled = isTurnActive(chat.status);
  return useMemo(() => ({ send, regenerate: regen, sendWithOrigin, disabled }), [send, regen, sendWithOrigin, disabled]);
}

/** A5 covers backend reachability only; stream failures render inline D-strips. */
function entryStateOf(hero: HeroSession, health: BackendHealth): ChatEntryState {
  return deriveEntryState({
    healthy: health.status !== "down",
    query: hero.entry.q,
    sessionId: hero.minted ? undefined : hero.entry.session,
    routeReference: resolveRouteReference(hero.entry.route),
  });
}

function useAutoSendFromQuery(hero: HeroSession, health: BackendHealth, send: (text: string) => void) {
  useAutoSend({
    query: hero.entry.q,
    enabled: health.healthy && hero.minted,
    send,
    sessionId: hero.entry.session,
  });
}

/** The conversation this page shows, including its address: the page mints the
 * id itself for a hero entry (#1901); a fresh draft publishes the id the
 * backend assigns (#1337). The minted entry is not a resume: nothing exists
 * to reconnect to or read back until the first POST lands. */
function useChatState(hero: HeroSession) {
  const entry = hero.entry;
  const config = useMemo(currentChatConfig, []);
  const health = useBackendHealth(config.baseUrl);
  const chat = useChatSession(config.chatUrl, entry.session, entry.session !== undefined && !hero.minted);
  const history = useConversationHistory(config.baseUrl, hero.minted ? undefined : entry.session);
  usePublishSessionId(entry, chat.sessionIdOf() ?? assignedSessionId(chat.messages));
  usePublishMintedSession(hero);
  return { config, health, chat, history: withoutSnapshotAssistant(history, snapshotOperationId(chat.messages, chat.operationIdOf())) };
}

/** A failed pick's resend, in the shape the recovery flow consumes. */
function useFailedPick(clarifyPick: ClarifyPickTurn) {
  const { status, resend } = clarifyPick;
  return useMemo(() => ({ failed: status === "failed", resend }), [status, resend]);
}

/** Tray state: the recompute + clarify-pick turns, their masked failure, and the spot store. */
function useTrayState(chat: ChatSession, gate: TurnFailureGate, sessionKey: string | undefined) {
  const clarifyPick = useClarifyPickState(chat, sessionKey);
  const turn = useTurnFailure(chat, gate, useFailedPick(clarifyPick));
  const recompute = useRecomputeTurn(chat, sessionKey);
  const failure = maskRecomputeFailure(recompute, turn.view);
  const selection = useSpotSelectionState(sessionKey);
  const locked = turn.quota.locked;
  return { recompute: lockedRecompute(recompute, locked), clarifyPick: lockedClarifyPick(clarifyPick, locked), failure, selection, quota: turn.quota };
}

/** Locale-bound page copy plus the departure surface that shares it. */
function usePageSurfaces(actions: ChatActions) {
  const locale = useLocale();
  const dict = chatDictFor(locale);
  const departure = useDeparturePrompt(actions, dict);
  return { dict, departure, locale };
}

function useGuardedTray(chat: ChatSession, auth: ReturnType<typeof useAuthStatus>, sessionKey: string | undefined) {
  return useTrayState(chat, { challenged: false, auth }, sessionKey);
}

/** The hero entry's two sends: the first fire and the reconnect-404 resend share one send. */
function useHeroSends(hero: HeroSession, chat: ChatSession, health: BackendHealth) {
  const heroSend = useHeroSend(chat, hero);
  useAutoSendFromQuery(hero, health, heroSend);
  useHeroResend(hero, chat, health.healthy, heroSend);
}

function useChatPage(hero: HeroSession) {
  const { config, health, chat, history } = useChatState(hero);
  const auth = useAuthStatus();
  const tray = useGuardedTray(chat, auth, hero.entry.session);
  const actions = useLockedActions(useTurnActions(chat), tray.quota.locked);
  const surfaces = usePageSurfaces(actions);
  useHeroSends(hero, chat, health);
  useHeroHistoryRefetch(hero, chat, history);
  return { config, health, chat, history, actions, auth, ...surfaces, ...tray };
}

type PageState = ReturnType<typeof useChatPage>;

/** What the composer is allowed to do this render (spec group G): A5 and the
 * A3 history gate take the field away, a running turn only takes the send key,
 * and a failed turn owes the visitor their words back. */
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
function chatBody(entry: ChatEntryState, chat: ChatSession, history: ConversationHistory, dict: ChatDict, onSend: (text: string) => void, failure: TurnFailureView | undefined, locale: Locale): ReactNode {
  return (
    <>
      <ChatIntro entry={entry} chat={chat} history={history} dict={dict} onSend={onSend} />
      <TurnStream chat={chat} dict={dict} failure={failure} locale={locale} />
      <ScrollAnchor count={history.entries.length + chat.messages.length} />
    </>
  );
}

/** Plain page-level assembly: the dock surfaces above the composer. */
function chatDock(departure: DeparturePromptState, dict: ChatDict, chat: ChatSession, recompute: RecomputeTurn): ReactNode {
  return (
    <>
      <DepartureGate departure={departure} dict={dict} />
      <DockTray dict={dict} chat={chat} recompute={recompute} />
    </>
  );
}

/** Plain page-level assembly: the direction-E composer dock (gold send and the
 * hint line) with its current send gate. */
function chatComposer(dict: ChatDict, quota: QuotaLock, onSend: (text: string) => void, gate: ComposerGate): ReactNode {
  return <ComposerDock dict={dict} gate={gate} quotaLocked={quota.locked} onSend={onSend} />;
}

function shellProps(search: ChatSearch, page: PageState, entry: ChatEntryState, gate: ComposerGate) {
  const chrome = {
    appbar: <ChatAppBar dict={page.dict} status={page.auth} />,
    sidebar: <ChatSidebar dict={page.dict} status={page.auth} baseUrl={page.config.baseUrl} activeSessionId={search.session} />,
    header: <ChatHeader dict={page.dict} title={journeyTitle(page.history.entries, page.chat.messages)} />,
    notices: <ChatNotices entry={entry} onRetry={page.health.retry} history={page.history} dict={page.dict} />,
  };
  return { ...chrome, body: chatBody(entry, page.chat, page.history, page.dict, page.departure.onSend, page.failure, page.locale), dock: chatDock(page.departure, page.dict, page.chat, page.recompute), composer: chatComposer(page.dict, page.quota, page.departure.onSend, gate) };
}

function ChatPageView({ hero, page }: Readonly<{ hero: HeroSession; page: PageState }>) {
  const entry = entryStateOf(hero, page.health);
  const gate = composerGateOf(entry, page.chat, page.history, page.failure);
  return <ChatShell {...shellProps(hero.entry, page, entry, gate)} />;
}

/** Publishes the live session id so every in-chat login wall and the settings
 * link can send the visitor back to this conversation (#507 review P1-1). */
function withReturnTarget(hero: HeroSession, page: PageState) {
  return (
    <ChatReturnTargetProvider sessionIdOf={page.chat.sessionIdOf}>
      <ChatPageView hero={hero} page={page} />
    </ChatReturnTargetProvider>
  );
}

/** The provider stack around the page view: spot selection, clarify pick, actions. */
function withProviders(hero: HeroSession, page: PageState) {
  return (
    <SpotSelectionProvider selection={page.selection}>
      <ClarifyPickProvider turn={page.clarifyPick}>
        <ChatActionsProvider actions={page.actions}>{withReturnTarget(hero, page)}</ChatActionsProvider>
      </ClarifyPickProvider>
    </SpotSelectionProvider>
  );
}

export function ChatPage(props: ChatPageProps) {
  const hero = useHeroSession(props.search);
  return withProviders(hero, useChatPage(hero));
}
