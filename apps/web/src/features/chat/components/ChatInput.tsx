import type { ChangeEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { readChatDraft, writeChatDraft } from "../lib/draft-storage";
import type { ChatDict } from "../i18n";
import { QUOTA_BANNER_ID } from "./ErrorStates/QuotaExhausted";

type Props = Readonly<{
  dict: ChatDict;
  /** A5 / A3: the composer is out of service — the field itself is withheld. */
  disabled: boolean;
  /** G4: a turn is running. The field stays live; only the send key is withheld. */
  busy?: boolean;
  /** D12 (#282 S1.10): the visitor's daily message quota is spent. */
  quotaLocked?: boolean;
  /** G5: the turn that just left failed, so its text belongs back in the field. */
  sendFailed?: boolean;
  onSend: (text: string) => void;
  /** BYOK settings entry point (#284 T6): present when the page hosts the panel. */
  settingsOpen?: boolean;
  onToggleSettings?: () => void;
}>;

type Submittable = Readonly<{ preventDefault: () => void }>;

function useDraftPersistence(text: string): void {
  useEffect(() => { writeChatDraft(text); }, [text]);
}

/** Only ever wired when the send is allowed, so the emptiness check that would
 * belong here lives in `sendWithheld` instead — one owner for one rule. */
function makeSubmit(text: string, commit: (sent: string) => void) {
  return (event: Submittable) => {
    event.preventDefault();
    commit(text.trim());
  };
}

/** G5: a failed turn took the visitor's words with it — put the trimmed payload
 * that `makeSubmit` handed off back in the field rather than making the visitor
 * retype. Assigning the value is what parks the caret at the end (HTML: setting
 * `value` collapses the selection there). */
function useFailedSendRefill(sendFailed: boolean, sent: { current: string }, setText: (text: string) => void) {
  useEffect(() => {
    if (!sendFailed || sent.current === "") return;
    setText(sent.current);
    sent.current = "";
  }, [sendFailed, sent, setText]);
}

/** The send itself: hand the text to the turn, clear the field, and remember
 * what left, because G5 may have to put it back. */
function useMessageHandoff(onSend: (text: string) => void, sent: { current: string }, setText: (text: string) => void) {
  return useCallback((value: string) => {
    sent.current = value;
    setText("");
    onSend(value);
  }, [onSend, sent, setText]);
}

function useComposer(onSend: (text: string) => void, sendFailed: boolean) {
  const [text, setText] = useState(readChatDraft);
  const sent = useRef("");
  const change = useCallback((event: ChangeEvent<HTMLInputElement>) => { setText(event.target.value); }, []);
  const commit = useMessageHandoff(onSend, sent, setText);
  useDraftPersistence(text);
  useFailedSendRefill(sendFailed, sent, setText);
  return { text, change, submit: useMemo(() => makeSubmit(text, commit), [text, commit]) };
}

/** D12 swallows the submit instead of clearing: the draft is the visitor's. */
function blockSubmit(event: Submittable) {
  event.preventDefault();
}

function placeholderFor(dict: ChatDict, quotaLocked: boolean, busy: boolean): string {
  if (quotaLocked) return dict.errorStates.d12InputHint;
  return busy ? dict.busyPlaceholder : dict.inputPlaceholder;
}

/** G3: the send key answers the field. Nothing to send, nothing to press. */
function sendWithheld(text: string, disabled: boolean, busy: boolean, quotaLocked: boolean): boolean {
  return disabled || busy || quotaLocked || text.trim() === "";
}

type ToggleProps = Readonly<{ dict: ChatDict; open: boolean; onToggle?: () => void }>;

/** The BYOK panel toggle (#284 T6): the composer is where a power user goes
 * looking for settings, so the entry point lives here (spec group G). */
function SettingsToggle({ dict, open, onToggle }: ToggleProps) {
  if (onToggle === undefined) return null;
  return (
    <button type="button" className="chat-input__settings" aria-label={dict.byok.settingsToggle} aria-expanded={open} aria-controls="byok-settings-panel" onClick={onToggle}>⚙</button>
  );
}

/** The paper plane of the design's `.composer .snd`. */
function SendGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round">
      <path d="M3.5 11.8 20.5 4l-7.4 16.6-2.3-6.9z" />
    </svg>
  );
}

/** G3: the round key. Its press shadow is CSS-side, keyed on `:disabled`. */
function SendKey({ dict, withheld }: Readonly<{ dict: ChatDict; withheld: boolean }>) {
  return (
    <button type="submit" className="chat-input__send" aria-label={dict.send} disabled={withheld}><SendGlyph /></button>
  );
}

type FieldProps = Readonly<{
  dict: ChatDict; disabled: boolean; busy: boolean; quotaLocked: boolean;
  text: string; onChange: (event: ChangeEvent<HTMLInputElement>) => void;
}>;

/**
 * The accessible NAME stays the ordinary placeholder in every state — a field
 * whose name changes to "sign in to send this" is a different control to a
 * screen reader. The reason is exposed as a DESCRIPTION instead, pointed at the
 * D12 banner that is already on screen and already announced as an alert.
 */
function ComposerField({ dict, disabled, busy, quotaLocked, text, onChange }: FieldProps) {
  return (
    <input className="chat-input__field" autoFocus value={text} placeholder={placeholderFor(dict, quotaLocked, busy)} aria-label={dict.inputPlaceholder} aria-describedby={quotaLocked ? QUOTA_BANNER_ID : undefined} disabled={disabled} onChange={onChange} />
  );
}

/**
 * G4's rule generalised for D12 (#282 S1.10): a running turn and a quota lock
 * both keep the composer editable and keep whatever is already typed — only the
 * send path is withheld, and the placeholder says why.
 */
export function ChatInput({ dict, disabled, busy = false, quotaLocked = false, sendFailed = false, onSend, settingsOpen = false, onToggleSettings }: Props) {
  const composer = useComposer(onSend, sendFailed);
  const withheld = sendWithheld(composer.text, disabled, busy, quotaLocked);
  return <form className={busy ? "chat-input chat-input--busy" : "chat-input"} onSubmit={withheld ? blockSubmit : composer.submit}>
    <SettingsToggle dict={dict} open={settingsOpen} onToggle={onToggleSettings} />
    <ComposerField dict={dict} disabled={disabled} busy={busy} quotaLocked={quotaLocked} text={composer.text} onChange={composer.change} />
    <SendKey dict={dict} withheld={withheld} />
  </form>;
}
