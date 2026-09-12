import { Button } from "animal-island-ui-tailwind/button";
import { Input } from "animal-island-ui-tailwind/input";
import { useId, useRef, useState } from "react";
import type { SubmitEvent } from "react";
import { useChatActions } from "../../ChatActions";
import { ProgressGlyph } from "../ProgressGlyph";

type Props = Readonly<{ label: string; placeholder: string; submitLabel: string; sentLabel: string }>;
const INPUT = "min-w-0 flex-1 [min-height:48px]! [border-radius:14px]! [--animal-bg-color:var(--color-paper)] [--animal-text-color:var(--color-fg)] [--animal-border-color:var(--color-border-soft)] [--animal-primary-color:var(--color-primary-strong)] focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-primary-strong [&_input]:[font-size:16px]! [&_input]:min-w-0";
const SUBMIT = "shrink-0 [width:48px]! [min-width:48px]! [height:48px]! [padding:0]! [--animal-bg-color:var(--color-primary)] [--animal-text-color:var(--color-primary-ink)] focus-visible:outline-primary-strong motion-reduce:transition-none!";

function useSearchEntry() {
  const actions = useChatActions(), [text, setText] = useState(""), [sent, setSent] = useState<string | null>(null), submitted = useRef<string | null>(null);
  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (actions.disabled || !text.trim() || submitted.current === text.trim()) return;
    submitted.current = text.trim(); actions.send(text.trim()); setSent(text.trim());
  };
  return { text, setText, submit, sent: sent !== null && sent === text.trim(), disabled: actions.disabled };
}

function SendGlyph() {
  return <svg aria-hidden="true" focusable="false" className="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14m-6-6 6 6-6 6" /></svg>;
}

/** New clues use the existing Chat action; a local acknowledgement is not a search result. */
export function FallbackSearchEntry({ label, placeholder, submitLabel, sentLabel }: Props) {
  const entry = useSearchEntry(), id = useId();
  return <form className="grid min-w-0 gap-2" onSubmit={entry.submit}>
    <label htmlFor={id} className="text-sm leading-5 text-muted-fg">{label}</label>
    <div className="flex min-w-0 items-start gap-2.5 pb-1"><Input id={id} className={INPUT} value={entry.text} placeholder={placeholder} disabled={entry.disabled} autoComplete="off" enterKeyHint="send" onChange={(event) => { entry.setText(event.target.value); }} /><Button htmlType="submit" type="primary" className={SUBMIT} aria-label={submitLabel} title={submitLabel} disabled={entry.disabled === true || !entry.text.trim() || entry.sent} icon={entry.sent ? <ProgressGlyph kind="done" /> : <SendGlyph />} /></div>
    <p role="status" aria-atomic="true" className="empty:hidden text-sm leading-6 text-muted-fg">{entry.sent ? sentLabel : ""}</p>
  </form>;
}
