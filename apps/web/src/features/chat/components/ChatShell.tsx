import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { TurnstileGate } from "./TurnstileGate";
import type { Locale } from "../../../i18n/locales";
import { ByokSettings } from "./ByokSettings";
import type { PanelPreferences } from "./ByokSettings";
import { ColdStart } from "./ColdStart";
import { DeparturePrompt } from "./DeparturePrompt";
import { PhotoSearchUpload } from "./PhotoSearchUpload";
import { ErrorBanner } from "./ErrorBanner";
import { SelectionTray } from "./SelectionTray";
import { TurnFailure } from "./ErrorStates/TurnFailure";
import type { TurnFailureView } from "./ErrorStates/TurnFailure";
import { HistoryList } from "./HistoryList";
import { MessageList } from "./MessageList";
import { WaitingRitual } from "./WaitingRitual";
import type { ChatEntryState } from "../entry-state";
import type { ChatDict } from "../i18n";
import type { PhotoSearchContext } from "../photo-search";
import type { RecomputeTurn } from "../selection/use-recompute-turn";
import type { ByokPanel } from "../use-byok-panel";
import type { DeparturePromptState } from "../use-departure-prompt";
import type { ConversationHistory } from "../use-conversation-history";
import type { ChatSession } from "../use-chat-session";
import type { TurnstileChallenge } from "../use-turnstile-challenge";
import { useTurnTiming } from "../use-turn-timing";

/** The chat-page frame: ChatPage assembles the five regions it owns. */
export type ChatShellProps = Readonly<{
  appbar: ReactNode;
  notices: ReactNode;
  body: ReactNode;
  dock: ReactNode;
  composer: ReactNode;
}>;

function useScrollAnchor(itemCount: number) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    ref.current?.scrollIntoView({ block: "end" });
  }, [itemCount]);
  return ref;
}

type ChatNoticesProps = Readonly<{
  entry: ChatEntryState;
  onRetry: () => void;
  history: ConversationHistory;
  dict: ChatDict;
}>;

/** Owns the page-level banners: the A5 retry and the history error. */
export function ChatNotices({ entry, onRetry, history, dict }: ChatNoticesProps) {
  return (
    <>
      {entry === "A5" ? <ErrorBanner dict={dict} onRetry={onRetry} /> : null}
      {history.status === "error" ? <ErrorBanner dict={dict} onRetry={history.retry} message={dict.historyError} /> : null}
    </>
  );
}

type ChatIntroProps = Readonly<{
  entry: ChatEntryState;
  chat: ChatSession;
  history: ConversationHistory;
  dict: ChatDict;
  onSend: (text: string) => void;
}>;

function showColdStart(chat: ChatSession, history: ConversationHistory, entry: ChatEntryState): boolean {
  return chat.messages.length === 0 && history.entries.length === 0 && entry !== "A3";
}

/** Owns the pre-turn region: the history summary and the cold-start invite. */
export function ChatIntro({ entry, chat, history, dict, onSend }: ChatIntroProps) {
  return (
    <>
      {history.status === "loading" ? <p className="chat-history-loading" role="status" aria-busy="true">{dict.preparing}</p> : null}
      <HistoryList entries={history.entries} dict={dict} />
      {showColdStart(chat, history, entry) ? <ColdStart dict={dict} onChip={onSend} disabled={entry === "A5"} /> : null}
    </>
  );
}

type TurnStreamProps = Readonly<{
  chat: ChatSession;
  dict: ChatDict;
  failure: TurnFailureView | undefined;
  locale: Locale;
  byok: ByokPanel;
}>;

/** Owns the live-turn region: messages, the failure strip, the waiting ritual. */
export function TurnStream({ chat, dict, failure, locale, byok }: TurnStreamProps) {
  const settledDurationMs = useTurnTiming(chat.status);
  return (
    <>
      <MessageList messages={chat.messages} dict={dict} status={chat.status} settledDurationMs={settledDurationMs} />
      <TurnFailure view={failure} dict={dict} locale={locale} onOpenSettings={byok.show} />
      <WaitingRitual status={chat.status} dict={dict} messages={chat.messages} />
    </>
  );
}

/** The a11y anchor, last in `.chat-body`, keeps the live region announced in
 * order after the ritual. */
export function ScrollAnchor({ count }: Readonly<{ count: number }>) {
  const ref = useScrollAnchor(count);
  return <div ref={ref} aria-hidden="true" />;
}

/** Owns the page frame: the appbar and notices above the chat body, the dock
 * rail and the composer below. */
export function ChatShell({ appbar, notices, body, dock, composer }: ChatShellProps) {
  return <main className="chat-page">
    {appbar}
    {notices}
    <section className="chat-body">{body}</section>
    <div className="chat-dock">{dock}</div>
    {composer}
  </main>;
}

/** C2t chips render only while a route request is held for departure info. */
export function DepartureGate({ departure, dict }: Readonly<{ departure: DeparturePromptState; dict: ChatDict }>) {
  if (departure.pending === null) return null;
  return <DeparturePrompt dict={dict} onChip={departure.onChip} onLocated={departure.onLocated} onManualLocation={departure.onManualLocation} />;
}

type DockTrayProps = Readonly<{
  dict: ChatDict;
  baseUrl: string;
  photo: PhotoSearchContext;
  chat: ChatSession;
  recompute: RecomputeTurn;
}>;

/** P1-3: the tray must not fire while ANY turn is in flight — the AI SDK's
 * `makeRequest` has no concurrency guard, so a mid-stream tap would clobber
 * the active response. Chat busy always reads as `busy` here. */
function trayStatus(chat: ChatSession, recompute: RecomputeTurn): RecomputeTurn["status"] {
  const active = chat.status === "submitted" || chat.status === "streaming";
  return active ? "busy" : recompute.status;
}

/** Owns the dock surfaces: photo upload and the E2 recompute tray. */
export function DockTray({ dict, baseUrl, photo, chat, recompute }: DockTrayProps) {
  const status = trayStatus(chat, recompute);
  return (
    <>
      <PhotoSearchUpload dict={dict} baseUrl={baseUrl} context={photo} />
      <span className="chat-live-note" aria-live="polite">{status === "busy" ? dict.preparing : ""}</span>
      <SelectionTray dict={dict} status={status} lastSentIds={recompute.lastSentIds} onRecompute={recompute.fire} />
    </>
  );
}

type ByokPanelGateProps = Readonly<{
  dict: ChatDict;
  baseUrl: string;
  byok: ByokPanel;
  /** App-level preferences the panel hosts, composed by the UI layer. */
  preferences?: PanelPreferences;
}>;

/** The ⚙ settings panel docks above the composer when toggled open (#284 T6). */
export function ByokPanelGate({ dict, baseUrl, byok, preferences }: ByokPanelGateProps) {
  if (!byok.open) return null;
  return <ByokSettings dict={dict} auth={byok.auth} baseUrl={baseUrl} preferences={preferences} />;
}

/** The dock's hint slot: silent until Turnstile decides a human check is due. */
export function ChallengeGate({ dict, challenge }: Readonly<{ dict: ChatDict; challenge: TurnstileChallenge | undefined }>) {
  if (challenge === undefined) return null;
  return <TurnstileGate dict={dict} {...challenge} />;
}
