import type { ChangeEvent } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { readChatDraft, writeChatDraft } from "../../../lib/chat/draftStorage";
import type { ChatDict } from "../i18n";
import { QUOTA_BANNER_ID } from "./ErrorStates/QuotaExhausted";

type Props = Readonly<{
  dict: ChatDict;
  disabled: boolean;
  /** D12 (#282 S1.10): the visitor's daily message quota is spent. */
  quotaLocked?: boolean;
  onSend: (text: string) => void;
  /** BYOK settings entry point (#284 T6): present when the page hosts the panel. */
  settingsOpen?: boolean;
  onToggleSettings?: () => void;
}>;

type Submittable = Readonly<{ preventDefault: () => void }>;

function useDraftPersistence(text: string): void {
  useEffect(() => { writeChatDraft(text); }, [text]);
}

function makeSubmit(text: string, reset: () => void, onSend: (t: string) => void) {
  return (event: Submittable) => {
    event.preventDefault();
    if (text.trim() === "") return;
    onSend(text.trim());
    reset();
  };
}

function useComposer(onSend: (text: string) => void) {
  const [text, setText] = useState(readChatDraft);
  const change = useCallback((event: ChangeEvent<HTMLInputElement>) => { setText(event.target.value); }, []);
  const reset = useCallback(() => { setText(""); }, []);
  const submit = useMemo(() => makeSubmit(text, reset, onSend), [text, reset, onSend]);
  useDraftPersistence(text);
  return { text, change, submit };
}

/** D12 swallows the submit instead of clearing: the draft is the visitor's. */
function blockSubmit(event: Submittable) {
  event.preventDefault();
}

function placeholderFor(dict: ChatDict, quotaLocked: boolean): string {
  return quotaLocked ? dict.errorStates.d12InputHint : dict.inputPlaceholder;
}

type ToggleProps = Readonly<{ dict: ChatDict; open: boolean; onToggle?: () => void }>;

/** The BYOK panel toggle (#284 T6): the composer is where a power user goes
 * looking for settings, so the entry point lives here (spec group G). */
function SettingsToggle({ dict, open, onToggle }: ToggleProps) {
  if (onToggle === undefined) return null;
  return (
    <button type="button" className="chat-input__settings" aria-label={dict.byok.settingsToggle} aria-expanded={open} onClick={onToggle}>⚙</button>
  );
}

/**
 * G4's rule generalised for D12 (#282 S1.10): a quota-locked composer stays
 * editable and keeps whatever is already typed — only the send path is
 * withheld, and the placeholder says why. Clearing the lock restores the
 * ordinary placeholder and the draft is still there to send.
 *
 * The accessible NAME stays the ordinary placeholder in both states — a field
 * whose name changes to "sign in to send this" is a different control to a
 * screen reader. The reason is exposed as a DESCRIPTION instead, pointed at the
 * D12 banner that is already on screen and already announced as an alert.
 */
export function ChatInput({ dict, disabled, quotaLocked = false, onSend, settingsOpen = false, onToggleSettings }: Props) {
  const composer = useComposer(onSend);
  return (
    <form className="chat-input" onSubmit={quotaLocked ? blockSubmit : composer.submit}>
      <SettingsToggle dict={dict} open={settingsOpen} onToggle={onToggleSettings} />
      <input className="chat-input__field" autoFocus value={composer.text} placeholder={placeholderFor(dict, quotaLocked)} aria-label={dict.inputPlaceholder} aria-describedby={quotaLocked ? QUOTA_BANNER_ID : undefined} disabled={disabled} onChange={composer.change} />
      <button type="submit" className="chat-input__send" disabled={disabled || quotaLocked || composer.text.trim() === ""}>{dict.send}</button>
    </form>
  );
}
