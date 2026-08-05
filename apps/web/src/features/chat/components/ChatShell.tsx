import { useEffect, useRef } from "react";
import { TurnstileGate } from "../../../components/TurnstileGate";
import type { Locale } from "../../../i18n/locales";
import { ByokSettings } from "./ByokSettings";
import { ChatInput } from "./ChatInput";
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
import type { RecomputeTurn } from "../selection/useRecomputeTurn";
import type { QuotaLock } from "../quota-lock";
import type { ByokPanel } from "../use-byok-panel";
import type { DeparturePromptState } from "../use-departure-prompt";
import type { ConversationHistory } from "../use-conversation-history";
import type { ChatSession } from "../use-chat-session";
import type { TurnstileChallenge } from "../use-turnstile-challenge";
import { useTurnTiming } from "../use-turn-timing";

export type ChatShellProps = Readonly<{
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

type BodyProps = Omit<ChatShellProps, "onRetry">;

function showColdStart({ entry, chat, history }: BodyProps): boolean {
  return chat.messages.length === 0 && history.entries.length === 0 && entry !== "A3";
}

function ColdStartGate(props: BodyProps) {
  if (!showColdStart(props)) return null;
  return <ColdStart dict={props.dict} onChip={props.onSend} disabled={props.entry === "A5"} />;
}

function HistoryLoadingGate({ history, dict }: Readonly<{ history: ConversationHistory; dict: ChatDict }>) {
  if (history.status !== "loading") return null;
  return <p className="chat-history-loading" role="status" aria-busy="true">{dict.preparing}</p>;
}

function ChatMessages({ chat, dict }: Readonly<{ chat: ChatSession; dict: ChatDict }>) {
  const settledDurationMs = useTurnTiming(chat.status);
  return <MessageList messages={chat.messages} dict={dict} status={chat.status} settledDurationMs={settledDurationMs} />;
}

/** The four stream-phase components; `ScrollAnchor` (last in `.chat-body`)
 * keeps the live region announced in order after the ritual. */
function StreamRegion(props: BodyProps) {
  return (
    <>
      <ColdStartGate {...props} />
      <ChatMessages chat={props.chat} dict={props.dict} />
      <TurnFailure view={props.failure} dict={props.dict} locale={props.locale} onOpenSettings={props.byok.show} />
      <WaitingRitual status={props.chat.status} dict={props.dict} messages={props.chat.messages} />
    </>
  );
}

function ScrollAnchor(props: BodyProps) {
  const ref = useScrollAnchor(props.history.entries.length + props.chat.messages.length);
  return <div ref={ref} aria-hidden="true" />;
}

function ChatBody(props: BodyProps) {
  return (
    <section className="chat-body">
      <HistoryLoadingGate history={props.history} dict={props.dict} />
      <HistoryList entries={props.history.entries} dict={props.dict} />
      <StreamRegion {...props} />
      <ScrollAnchor {...props} />
    </section>
  );
}

function HistoryErrorGate({ history, dict }: Readonly<{ history: ConversationHistory; dict: ChatDict }>) {
  if (history.status !== "error") return null;
  return <ErrorBanner dict={dict} onRetry={history.retry} message={dict.historyError} />;
}

function isInputLocked(props: ChatShellProps): boolean {
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

/** Entry A5 (soft-locked) shows the retry banner above the history error. */
function A5RetryGate(props: ChatShellProps) {
  if (props.entry !== "A5") return null;
  return <ErrorBanner dict={props.dict} onRetry={props.onRetry} />;
}

function ShellNotices(props: ChatShellProps) {
  return (
    <>
      <A5RetryGate {...props} />
      <HistoryErrorGate history={props.history} dict={props.dict} />
    </>
  );
}

/** The C2t chips and photo upload sit between the stream and the composer. */
function ComposerExtras(props: ChatShellProps) {
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
function ComposerDock(props: ChatShellProps) {
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
function Composer(props: ChatShellProps) {
  return (
    <>
      <ByokPanelGate dict={props.dict} baseUrl={props.baseUrl} byok={props.byok} />
      <ChatInput dict={props.dict} disabled={isInputLocked(props)} quotaLocked={props.quota.locked} onSend={props.onSend} settingsOpen={props.byok.open} onToggleSettings={props.byok.toggle} />
      <ChallengeGate dict={props.dict} challenge={props.challenge} />
    </>
  );
}

export function ChatShell(props: ChatShellProps) {
  return (
    <main className="chat-page">
      <ShellNotices {...props} />
      <ChatBody {...props} />
      <ComposerDock {...props} />
      <Composer {...props} />
    </main>
  );
}
