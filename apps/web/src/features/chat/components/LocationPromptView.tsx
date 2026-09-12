import { Button } from "animal-island-ui-tailwind/button";
import { Input } from "animal-island-ui-tailwind/input";
import { useId, useRef, useState } from "react";
import type { SubmitEvent } from "react";
import type { ChatDict } from "../i18n";
import { ProgressGlyph } from "./ProgressGlyph";

export type LocationPromptState =
  | Readonly<{ phase: "idle" | "pending" | "denied" }>
  | Readonly<{ phase: "sent"; place?: string }>;

export type LocationPromptViewProps = Readonly<{
  dict: ChatDict; state: LocationPromptState; disabled?: boolean;
  onLocate: () => void; onManual: (text: string) => void;
}>;

const LOCATE = "justify-self-start [min-height:46px]! [height:auto]! [padding:10px_16px]! [font-size:14px]! [line-height:1.5]! [white-space:normal]! [--animal-bg-color:var(--color-primary-soft)] [--animal-text-color:var(--color-primary-strong)] [--animal-border-color:var(--color-border-soft)] focus-visible:outline-primary-strong motion-reduce:transition-none";
const INPUT = "min-w-0 flex-1 [min-height:48px]! [border-radius:14px]! [--animal-bg-color:var(--color-paper)] [--animal-text-color:var(--color-fg)] [--animal-border-color:var(--color-border-soft)] [--animal-primary-color:var(--color-primary-strong)] focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-primary-strong [&_input]:[font-size:16px]! [&_input]:min-w-0";
const SUBMIT = "shrink-0 [width:48px]! [min-width:48px]! [height:48px]! [padding:0]! [--animal-bg-color:var(--color-primary)] [--animal-text-color:var(--color-primary-ink)] focus-visible:outline-primary-strong motion-reduce:transition-none";

function LocationGlyph({ kind }: Readonly<{ kind: "locate" | "arrow" }>) {
  const path = kind === "locate" ? "M12 2v3m0 14v3M2 12h3m14 0h3" : "M5 12h14m-6-6 6 6-6 6";
  return <svg aria-hidden="true" focusable="false" className="size-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d={path} />{kind === "locate" ? <><circle cx="12" cy="12" r="7" /><circle cx="12" cy="12" r="2" /></> : null}</svg>;
}

function LocateAction(props: LocationPromptViewProps) {
  const pending = props.state.phase === "pending";
  return <Button htmlType="button" type="default" className={LOCATE} aria-busy={pending} disabled={props.disabled === true || pending} onClick={props.onLocate} icon={pending ? <ProgressGlyph kind="running" /> : <LocationGlyph kind="locate" />}>
    {props.dict.location.allow}
  </Button>;
}

function LocationStatus({ state, dict }: Pick<LocationPromptViewProps, "state" | "dict">) {
  if (state.phase !== "pending" && state.phase !== "denied") return null;
  const message = state.phase === "pending" ? dict.location.waiting : dict.location.denied;
  const tone = state.phase === "denied" ? "border-l-2 border-gold pl-3" : "";
  return <p role="status" aria-atomic="true" className={`text-sm leading-6 text-muted-fg ${tone}`}>{message}</p>;
}

function useManualEntry(props: LocationPromptViewProps) {
  const [text, setText] = useState(""), submitted = useRef(false);
  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (props.disabled || submitted.current || !text.trim()) return;
    submitted.current = true; props.onManual(text.trim());
  };
  return { text, setText, submit };
}

function ManualLocationEntry(props: LocationPromptViewProps) {
  const entry = useManualEntry(props), id = useId(), copy = props.dict.location;
  return <form onSubmit={entry.submit} className="grid min-w-0 gap-2">
    <label htmlFor={id} className="text-sm leading-5 text-muted-fg">{copy.manualLabel}</label>
    <div className="flex min-w-0 items-start gap-2.5 pb-1">
      <Input id={id} className={INPUT} value={entry.text} placeholder={copy.manualPlaceholder} disabled={props.disabled} autoComplete="off" spellCheck={false} enterKeyHint="send" onChange={(event) => { entry.setText(event.target.value); }} />
      <Button htmlType="submit" type="primary" className={SUBMIT} disabled={props.disabled === true || !entry.text.trim()} aria-label={copy.manualSubmit} title={copy.manualSubmit} icon={<LocationGlyph kind="arrow" />} />
    </div>
  </form>;
}

function SubmittedLocation({ dict, state }: Pick<LocationPromptViewProps, "dict" | "state">) {
  if (state.phase !== "sent") return null;
  return <div className="flex items-start gap-3 py-1">
    <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-primary-soft text-primary-strong"><ProgressGlyph kind="done" /></span>
    <div className="grid min-w-0 gap-1"><p role="status" className="text-sm leading-6 text-muted-fg">{dict.location.sent}</p><p className="text-base font-semibold leading-7 text-fg [overflow-wrap:anywhere]">{state.place ?? dict.location.current}</p></div>
  </div>;
}

/** Only the explicit location action asks for permission; manual entry is always available. */
export function LocationPromptView(props: LocationPromptViewProps) {
  return <div role="group" aria-label={props.dict.clarify.locationPrompt} className="grid w-full max-w-[452px] gap-4 text-fg">
    {props.state.phase === "sent" ? <SubmittedLocation {...props} /> : <><LocateAction {...props} /><LocationStatus {...props} /><ManualLocationEntry {...props} /></>}
  </div>;
}
