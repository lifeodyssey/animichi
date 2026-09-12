import { Button } from "animal-island-ui-tailwind/button";
import { Input } from "animal-island-ui-tailwind/input";
import { useEffect, useId, useRef, useState } from "react";
import type { RefObject } from "react";

export interface TripConditionFieldProps {
  readonly label: string;
  readonly placeholder: string;
  readonly value: string;
  readonly editLabel: string;
  readonly disabled?: boolean;
  readonly presets?: readonly string[];
  readonly customLabel?: string;
  readonly focusOnOpen?: boolean;
  readonly onChange: (value: string) => void;
}

export const CONDITION_ACTION = "[min-height:44px]! [padding:0_10px]! [font-size:14px]! [--animal-text-color:var(--color-muted-fg)] [--animal-bg-color-secondary:var(--color-primary-soft)] focus-visible:[outline-color:var(--color-primary-strong)] motion-reduce:transition-none";
const INPUT = "w-full [min-height:48px]! [border-radius:14px]! [--animal-bg-color:var(--color-paper)] [--animal-border-color:var(--color-border)] [--animal-text-color:var(--color-fg)] [--animal-primary-color:var(--color-primary-strong)] [&_input]:[font-size:16px]! [&_input]:min-w-0";
const PRESET = "[height:auto]! [min-height:46px]! [padding:8px_10px]! [border-radius:14px]! [font-size:14px]! [white-space:normal]! [line-height:1.4]! [--animal-bg-color:var(--color-paper)] [--animal-border-color:var(--color-border)] [--animal-text-color:var(--color-fg)] [--animal-primary-color:var(--color-primary-strong)] aria-pressed:[--animal-bg-color:var(--color-primary)] aria-pressed:[--animal-border-color:var(--color-primary-strong)] aria-pressed:[--animal-text-color:var(--color-primary-ink)] aria-pressed:[--animal-primary-color:var(--color-primary-ink)] focus-visible:[outline-color:var(--color-primary-strong)] motion-reduce:transition-none";

type EditorProps = TripConditionFieldProps & Readonly<{ inputId: string; inputRef?: RefObject<HTMLInputElement | null> }>;

function ConditionInput({ inputId, inputRef, label, value, placeholder, disabled, onChange }: EditorProps) {
  return <Input ref={inputRef} id={inputId} aria-label={label} value={value} placeholder={placeholder} disabled={disabled} className={INPUT} autoComplete="off" onChange={(event) => { onChange(event.target.value); }} />;
}

function focusEditor(root: HTMLDivElement | null) {
  const target = root?.querySelector("input") ?? root?.querySelector("button");
  target?.focus();
}

function useConditionEditor({ value, focusOnOpen }: TripConditionFieldProps) {
  const [editing, setEditing] = useState(() => !value.trim());
  const rootRef = useRef<HTMLDivElement>(null);
  const requestedFocus = useRef(Boolean(focusOnOpen));
  useEffect(() => { if (editing && requestedFocus.current) { focusEditor(rootRef.current); requestedFocus.current = false; } }, [editing]);
  const edit = () => { requestedFocus.current = true; setEditing(true); };
  return { editing, rootRef, edit };
}

function KnownCondition({ value, label, editLabel, disabled, onEdit }: TripConditionFieldProps & Readonly<{ onEdit: () => void }>) {
  return <div className="flex min-h-12 items-center justify-between gap-3">
    <p className="min-w-0 text-base font-bold leading-7 [overflow-wrap:anywhere]">{value}</p>
    <Button type="text" htmlType="button" className={`${CONDITION_ACTION} shrink-0`} disabled={disabled} aria-label={`${editLabel}: ${label}`} onClick={onEdit}>{editLabel}</Button>
  </div>;
}

type TimePresetsProps = EditorProps & Readonly<{ presets: readonly string[] }>;

function useTimePresets(props: TimePresetsProps) {
  const [custom, setCustom] = useState(() => Boolean(props.value.trim()) && !props.presets.includes(props.value));
  const customInput = useRef<HTMLInputElement>(null);
  useEffect(() => { if (custom) customInput.current?.focus(); }, [custom]);
  const showCustom = custom || Boolean(props.value.trim() && !props.presets.includes(props.value));
  const pick = (preset: string) => { setCustom(false); props.onChange(props.value === preset && !showCustom ? "" : preset); };
  return { custom: showCustom, customInput, pick, openCustom: () => { setCustom(true); } };
}

function TimePresets(props: TimePresetsProps) {
  const editor = useTimePresets(props);
  return <div className="grid gap-3"><div className="grid grid-cols-3 gap-2" role="group" aria-label={props.label}>
    {props.presets.map((preset) => <Button key={preset} type="default" htmlType="button" disabled={props.disabled} className={PRESET} aria-pressed={!editor.custom && props.value === preset} onClick={() => { editor.pick(preset); }}>{preset}</Button>)}
    <Button type="default" htmlType="button" disabled={props.disabled} className={PRESET} aria-pressed={editor.custom} aria-expanded={editor.custom} aria-controls={editor.custom ? props.inputId : undefined} onClick={editor.openCustom}>{props.customLabel}</Button>
  </div>{editor.custom && <ConditionInput {...props} inputRef={editor.customInput} />}</div>;
}

function ConditionEditor(props: EditorProps) {
  if (props.presets) return <TimePresets {...props} presets={props.presets} />;
  return <ConditionInput {...props} />;
}

export function TripConditionField(props: TripConditionFieldProps) {
  const editor = useConditionEditor(props);
  const inputId = useId();
  return <div ref={editor.rootRef} className="grid gap-1.5">
    <p className="text-sm font-medium leading-5 text-muted-fg">{props.label}</p>
    {editor.editing || !props.value.trim() ? <ConditionEditor {...props} inputId={inputId} /> : <KnownCondition {...props} onEdit={editor.edit} />}
  </div>;
}
