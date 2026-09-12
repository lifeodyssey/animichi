import { Button } from "animal-island-ui-tailwind/button";
import { Input } from "animal-island-ui-tailwind/input";
import type { ChangeEvent, ReactNode } from "react";
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
  /** The camera trigger (photo search) rendered inside the pill's left edge. */
  leading?: ReactNode;
  onSend: (text: string) => void;
}>;

type Submittable = Readonly<{ preventDefault: () => void }>;

const COMPOSER_CLASS = "w-full [--animal-font-family:var(--app-font-body)] [--animal-bg-color-secondary:var(--color-muted)]";
/** Keep the library's input ledge; focus changes only the warm, quiet edge. */
const PILL_CLASS = "h-auto min-h-16 w-full [gap:0.5rem] rounded-[28px] border-2 border-fg/70 bg-card p-2 text-ground-ink focus-within:border-primary-strong night:focus-within:border-primary sm:[gap:0.75rem] [&_.animal-input-prefix]:m-0 [&_.animal-input-suffix]:m-0 motion-reduce:transition-none";
const FIELD_CLASS = "[&_.animal-input-control]:h-11 [&_.animal-input-control]:text-base [&_.animal-input-control]:font-semibold [&_.animal-input-control]:leading-6 [&_.animal-input-control]:tracking-normal [&_.animal-input-control]:text-ground-ink [&_.animal-input-control]:caret-primary-strong [&_.animal-input-control::placeholder]:font-normal [&_.animal-input-control::placeholder]:text-muted-fg night:[&_.animal-input-control]:caret-primary";

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

function SendGlyph() {
  return (
    <svg className="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M12 19V5m-6 6 6-6 6 6" />
    </svg>
  );
}

const SEND_CLASS = "size-11 min-h-11 shrink-0 border-0 bg-gold p-0 text-gold-ink [--animal-bg-color:var(--color-gold)] [--animal-text-color:var(--color-gold-ink)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary-strong night:focus-visible:outline-primary disabled:bg-muted disabled:text-muted-fg disabled:[--animal-text-color:var(--color-muted-fg)] disabled:opacity-100 motion-reduce:[animation:none] motion-reduce:transition-none";

/** G3: the round gold key goes flat and muted when there is nothing to send. */
function SendKey({ dict, withheld, busy }: Readonly<{ dict: ChatDict; withheld: boolean; busy: boolean }>) {
  return (
    <Button type="primary" htmlType="submit" className={SEND_CLASS} aria-label={dict.send} disabled={withheld} loading={busy} icon={<SendGlyph />} />
  );
}

type FieldProps = Readonly<{
  dict: ChatDict; disabled: boolean; busy: boolean; quotaLocked: boolean;
  text: string; onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  leading: ReactNode; trailing: ReactNode;
}>;

/**
 * The accessible NAME stays the ordinary placeholder in every state — a field
 * whose name changes to "sign in to send this" is a different control to a
 * screen reader. The reason is exposed as a DESCRIPTION instead, pointed at the
 * D12 banner that is already on screen and already announced as an alert.
 */
function ComposerField({ dict, disabled, busy, quotaLocked, text, onChange, leading, trailing }: FieldProps) {
  const describedby = quotaLocked ? QUOTA_BANNER_ID : undefined;
  return (
    <Input className={`${PILL_CLASS} ${FIELD_CLASS}`} shadow autoFocus value={text} onChange={onChange} disabled={disabled} prefix={leading} suffix={trailing} aria-label={dict.inputPlaceholder} placeholder={placeholderFor(dict, quotaLocked, busy)} aria-describedby={describedby} />
  );
}

/**
 * G4's rule generalised for D12 (#282 S1.10): a running turn and a quota lock
 * both keep the composer editable and keep whatever is already typed — only the
 * send path is withheld, and the placeholder says why. Busy feedback belongs
 * to the send key so the visitor can still read and edit their next thought.
 */
export function ChatInput({ dict, disabled, busy = false, quotaLocked = false, sendFailed = false, leading, onSend }: Props) {
  const composer = useComposer(onSend, sendFailed);
  const withheld = sendWithheld(composer.text, disabled, busy, quotaLocked);
  const submit = withheld ? blockSubmit : composer.submit;
  const trailing = <SendKey dict={dict} withheld={withheld} busy={busy} />;
  const field = <ComposerField dict={dict} disabled={disabled} busy={busy} quotaLocked={quotaLocked} text={composer.text} onChange={composer.change} leading={leading} trailing={trailing} />;
  return (
    <form className={COMPOSER_CLASS} onSubmit={submit}>{field}</form>
  );
}
