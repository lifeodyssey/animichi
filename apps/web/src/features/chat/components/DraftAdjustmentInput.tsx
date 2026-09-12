import { Button } from "animal-island-ui-tailwind/button";
import { useId } from "react";
import type { RefObject, SubmitEvent } from "react";
import type { ChatDict } from "../i18n";
import type { DraftAdjustmentStatus } from "../lib/draft-adjustment";
import { draftAdjustmentCopy } from "../draft-adjustment-copy";

export interface DraftAdjustmentInputProps {
  readonly dict: ChatDict;
  readonly value: string;
  readonly status?: DraftAdjustmentStatus;
  readonly canSubmit: boolean;
  readonly onChange: (value: string) => void;
  readonly onSubmit: () => void;
  readonly onBack: () => void;
  readonly formId: string;
  readonly inputRef: RefObject<HTMLTextAreaElement | null>;
}

type EditorProps = DraftAdjustmentInputProps & Readonly<{ inputId: string; inputRef: RefObject<HTMLTextAreaElement | null> }>;
const ACTION = "[min-height:48px]! [height:auto]! [padding:10px_8px]! @min-[25rem]/draft:[padding:10px_14px]! [font-size:14px]! [line-height:1.5]! [white-space:normal]! focus-visible:[outline-color:var(--color-primary-strong)] motion-reduce:transition-none";
const QUIET = "[--animal-text-color:var(--color-fg)] [--animal-bg-color-secondary:var(--color-primary-soft)]";
const SUGGESTION = "[min-height:44px]! [height:auto]! [padding:8px_14px]! [font-size:13px]! [line-height:1.5]! [white-space:normal]! [--animal-bg-color:var(--color-paper)] [--animal-border-color:var(--color-border-soft)] [--animal-text-color:var(--color-muted-fg)] [--animal-primary-color:var(--color-primary-strong)] focus-visible:[outline-color:var(--color-primary-strong)] motion-reduce:transition-none";
const INPUT = "animal-input-wrapper animal-input-middle w-full [height:auto]! [padding:0]! [border-radius:16px]! [border:1px_solid_var(--color-border-soft)]! [background:var(--color-paper)]! focus-within:[border-color:var(--color-primary-strong)]! focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-primary-strong motion-reduce:transition-none";

function appendSuggestion(props: EditorProps, request: string) {
  if (props.status === "updating" || props.value.includes(request)) return;
  props.onChange(props.value.trim() ? `${props.value}\n${request}` : request);
  props.inputRef.current?.focus();
}

function AdjustmentSuggestions(props: EditorProps) {
  const copy = draftAdjustmentCopy(props.dict.locale);
  const suggestions = [{ label: copy.later, request: copy.laterRequest }, { label: copy.slower, request: copy.slowerRequest }];
  return <div role="group" aria-label={copy.suggestions} className="flex flex-wrap gap-2">{suggestions.map((suggestion) => <Button key={suggestion.label} type="default" htmlType="button" className={SUGGESTION} disabled={props.status === "updating" || props.value.includes(suggestion.request)} onClick={() => { appendSuggestion(props, suggestion.request); }}>{suggestion.label}</Button>)}</div>;
}

function AdjustmentEditor(props: EditorProps) {
  const copy = draftAdjustmentCopy(props.dict.locale);
  return <div className="grid gap-3"><label className="sr-only" htmlFor={props.inputId}>{copy.input}</label>
    <span className={INPUT}><textarea ref={props.inputRef} id={props.inputId} className="animal-input-control [min-height:104px] [max-height:280px] [resize:vertical] [padding:14px]! [font-size:16px]! [line-height:1.8]! [color:var(--color-fg)] [overflow-wrap:anywhere] placeholder:[color:var(--color-muted-fg)]" rows={2} value={props.value} placeholder={copy.placeholder} readOnly={props.status === "updating"} onChange={(event) => { props.onChange(event.target.value); }} /></span>
    <AdjustmentSuggestions {...props} />
  </div>;
}

function AdjustmentFeedback({ status, dict }: DraftAdjustmentInputProps) {
  const copy = draftAdjustmentCopy(dict.locale);
  if (status === "updating") return <p role="status" className="text-sm leading-6 text-muted-fg">{copy.pending}</p>;
  if (status === "failed") return <p role="status" className="border-l-2 border-gold pl-3 text-sm leading-6 text-muted-fg">{copy.failed}</p>;
  return null;
}

export function DraftAdjustmentActions(props: DraftAdjustmentInputProps & Readonly<{ onWrite: () => void }>) {
  const copy = draftAdjustmentCopy(props.dict.locale);
  const label = props.status === "updating" ? copy.updating : props.status === "failed" ? copy.retry : copy.submit;
  return <div className="flex flex-wrap items-center gap-1.5 pb-1 @min-[25rem]/draft:gap-2"><Button type="primary" htmlType="submit" form={props.formId} className={`${ACTION} [--animal-bg-color:var(--color-gold)] [--animal-text-color:var(--color-gold-ink)]`} disabled={!props.canSubmit || props.status === "updating"} aria-busy={props.status === "updating"}>{label}</Button>
    <Button type="text" htmlType="button" aria-label={copy.back} className={`${ACTION} ${QUIET}`} onClick={props.onBack}><span className="[display:none] @min-[25rem]/draft:[display:inline]">{copy.back}</span><span className="[display:inline] @min-[25rem]/draft:[display:none]">{copy.backShort}</span></Button>
    <Button type="text" htmlType="button" title={copy.write} aria-label={copy.write} className={`${ACTION} ${QUIET} ml-auto [width:44px]! [padding:0]!`} onClick={props.onWrite}><svg aria-hidden="true" width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="m15 4 5 5M4 20l5-1L21 7a2 2 0 0 0-5-5L4 14z" /></svg></Button>
  </div>;
}

function submitAdjustment(event: SubmitEvent<HTMLFormElement>, props: DraftAdjustmentInputProps) {
  event.preventDefault();
  if (!props.canSubmit || props.status === "updating") return;
  props.onSubmit();
}

/** Inline input underneath the itinerary; it never replaces the place list. */
export function DraftAdjustmentInput(props: DraftAdjustmentInputProps) {
  const titleId = useId(), inputId = useId();
  return <form id={props.formId} aria-labelledby={titleId} className="grid gap-4 border-t border-border-soft pt-5 pb-5" onSubmit={(event) => { submitAdjustment(event, props); }}>
    <h3 id={titleId} className="text-base font-bold leading-6">{draftAdjustmentCopy(props.dict.locale).title}</h3><AdjustmentEditor {...props} inputId={inputId} /><AdjustmentFeedback {...props} />
  </form>;
}
