import { useEffect, useId, useRef, useState } from "react";
import type { ReactNode, SubmitEvent } from "react";
import { AnimalButton } from "./AnimalButton";

type Props = Readonly<{
  label: string;
  placeholder: string;
  submitLabel: string;
  sentLabel: string;
  disabled?: boolean;
  focusOnMount?: boolean;
  secondaryAction?: ReactNode;
  onSubmit: (text: string) => void;
}>;

const INPUT = "animal-input-wrapper animal-input-middle [min-height:48px]! [height:auto]! [border-radius:14px] [border:1px_solid_var(--color-border-soft)] [background:var(--color-paper)] focus-within:outline-[3px] focus-within:outline-offset-2 focus-within:outline-ground-ink motion-reduce:transition-none";

function useEntryState({ disabled, onSubmit }: Props) {
  const [text, setText] = useState("");
  const [sent, setSent] = useState(false);
  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (disabled || text.trim() === "") return;
    onSubmit(text.trim()); setText(""); setSent(true);
  };
  return { text, sent, submit, change: (value: string) => { setText(value); setSent(false); } };
}

type FieldProps = Pick<Props, "label" | "placeholder" | "disabled" | "focusOnMount"> & Readonly<{ text: string; onChange: (value: string) => void }>;

function useEntryFocus(focusOnMount: boolean | undefined) {
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { if (focusOnMount) input.current?.focus(); }, [focusOnMount]);
  return input;
}

function EntryField({ label, placeholder, disabled, focusOnMount, text, onChange }: FieldProps) {
  const id = useId();
  const input = useEntryFocus(focusOnMount);
  return (
    <label htmlFor={id} className="grid min-w-0 gap-2 text-sm font-bold text-fg">
      {label}
      <span className={`${INPUT} ${disabled ? "animal-input-disabled" : ""}`} aria-disabled={disabled}><input ref={input} id={id} className="animal-input-control [min-width:0] [font-size:16px]! [color:var(--color-fg)]" value={text} placeholder={placeholder} disabled={disabled} onChange={(event) => { onChange(event.target.value); }} /></span>
    </label>
  );
}

function EntryActions({ label, sentLabel, disabled, sent, secondaryAction }: Readonly<{ label: string; sentLabel: string; disabled: boolean; sent: boolean; secondaryAction?: ReactNode }>) {
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2"><AnimalButton type="submit" tone="primary" className="[min-height:48px]! [--animal-bg-color:var(--color-primary)]! [--animal-text-color:var(--color-primary-ink)]!" disabled={disabled}>{label}</AnimalButton>{secondaryAction}</div>
      {sent && sentLabel && <p role="status" className="text-sm leading-relaxed text-muted-fg">{sentLabel}</p>}
    </div>
  );
}

export function ClarifyTextEntry(props: Props) {
  const entry = useEntryState(props);
  return (
    <form className="grid w-full gap-4" onSubmit={entry.submit}>
      <EntryField {...props} text={entry.text} onChange={entry.change} />
      <EntryActions label={props.submitLabel} sentLabel={props.sentLabel} disabled={props.disabled === true || entry.text.trim() === ""} sent={entry.sent} secondaryAction={props.secondaryAction} />
    </form>
  );
}
