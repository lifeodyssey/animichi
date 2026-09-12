import { Button } from "animal-island-ui-tailwind/button";
import { useId, useRef, useState } from "react";
import type { ChatDict } from "../i18n";
import type { ItineraryDraftPlan } from "../lib/itinerary-draft";
import type { DraftAdjustmentRequest, DraftAdjustmentStatus } from "../lib/draft-adjustment";
import type { SelectedPlace, SelectionEdit } from "../lib/selected-places";
import type { SceneViewpoint } from "../lib/scene-group";
import { addDraftViewpoint, availableDraftPlaces, draftSelectionChanged, draftWithSelection, removeDraftViewpoint } from "../lib/draft-adjustment";
import { removeSelectedPlace } from "../lib/selected-places";
import { selectedPlacesCopy } from "../selected-places-copy";
import { draftAdjustmentCopy } from "../draft-adjustment-copy";
import { itineraryDraftCopy } from "../itinerary-draft-copy";
import { ItineraryDraftDocument } from "./ItineraryDraft";
import { DraftAdjustmentActions, DraftAdjustmentInput } from "./DraftAdjustmentInput";
import type { DraftAdjustmentInputProps } from "./DraftAdjustmentInput";
import { DraftPlacePicker } from "./DraftPlacePicker";
import { useSelectedPlaceReview } from "./use-selected-place-review";

export interface DraftAdjustmentProps {
  readonly draft: ItineraryDraftPlan;
  readonly dict: ChatDict;
  readonly places: readonly SelectedPlace[];
  readonly candidates: readonly SelectedPlace[];
  readonly value: string;
  readonly status?: DraftAdjustmentStatus;
  readonly onChange: (value: string) => void;
  readonly onPlacesChange: (places: readonly SelectedPlace[]) => void;
  readonly onSubmit: (request: DraftAdjustmentRequest) => void;
  readonly onBack: (draftId: string) => void;
}

const QUIET = "[min-height:44px]! [height:auto]! [padding:8px_12px]! [font-size:14px]! [line-height:1.5]! [white-space:normal]! [--animal-text-color:var(--color-primary-strong)] [--animal-bg-color-secondary:var(--color-primary-soft)] focus-visible:[outline-color:var(--color-primary-strong)] motion-reduce:transition-none";

function toggleViewpoint(props: DraftAdjustmentProps, apply: (edit: SelectionEdit) => void, place: SelectedPlace, viewpoint: SceneViewpoint) {
  if (props.status === "updating") return;
  const selected = props.places.find((item) => item.id === place.id);
  if (selected?.viewpoints.some((item) => item.id === viewpoint.id)) { const edit = removeDraftViewpoint(props.places, selected, viewpoint); if (selected.viewpoints.length === 1) apply(edit); else props.onPlacesChange(edit.places); return; }
  props.onPlacesChange(addDraftViewpoint(props.places, place, viewpoint));
}

function useDraftPlaceEditing(props: DraftAdjustmentProps) {
  const review = useSelectedPlaceReview(props.places, props.onPlacesChange);
  const availablePlaces = availableDraftPlaces(props.draft, props.candidates, props.places);
  const onRemove = (place: SelectedPlace) => { if (props.status !== "updating") review.apply(removeSelectedPlace(props.places, place)); };
  const onToggle = (place: SelectedPlace, viewpoint: SceneViewpoint) => { toggleViewpoint(props, review.apply, place, viewpoint); };
  const pick = (place: SelectedPlace, viewpoint: SceneViewpoint) => { toggleViewpoint(props, (edit) => { props.onPlacesChange(edit.places); }, place, viewpoint); };
  return { ...review, pick, controls: { availablePlaces, disabled: props.status === "updating", onRemove, onToggle } };
}

type Editing = ReturnType<typeof useDraftPlaceEditing>;

function RemovedPlace({ editing, dict, disabled }: Readonly<{ editing: Editing; dict: ChatDict; disabled: boolean }>) {
  const copy = selectedPlacesCopy(dict.locale), removed = editing.removed;
  if (!removed) return null;
  const message = (removed.viewpointIndex === undefined ? copy.removed : copy.removedViewpoint).replace("{name}", removed.place.name);
  return <div role="status" className="flex flex-wrap items-center justify-between gap-1 rounded-xl bg-primary-soft px-3 py-1"><span className="min-w-0 text-sm leading-6 text-primary-ink [overflow-wrap:anywhere]">{message}</span><Button type="text" htmlType="button" className={QUIET} disabled={disabled} onClick={editing.undo}>{copy.undo}</Button></div>;
}

function AddPlaces({ props, editing }: Readonly<{ props: DraftAdjustmentProps; editing: Editing }>) {
  const [open, setOpen] = useState(false), trigger = useRef<HTMLButtonElement>(null), copy = draftAdjustmentCopy(props.dict.locale);
  const close = () => { setOpen(false); trigger.current?.focus({ preventScroll: true }); };
  return <div className="grid gap-3">{props.places.length === 0 ? <p className="text-sm leading-6 text-muted-fg">{copy.empty}</p> : null}
    <div><Button ref={trigger} type="text" htmlType="button" className={QUIET} disabled={editing.controls.disabled} aria-expanded={open} onClick={() => { setOpen(!open); }}><span className="flex items-center gap-2"><span aria-hidden="true" className="text-xl font-normal">+</span>{copy.add}</span></Button></div>
    {open && !editing.controls.disabled ? <DraftPlacePicker dict={props.dict} available={editing.controls.availablePlaces} selected={props.places} onToggle={editing.pick} onDone={close} /> : null}
  </div>;
}

function submitAdjustment(props: DraftAdjustmentProps) {
  if (props.status === "updating" || !props.places.length) return;
  if (!props.value.trim() && !draftSelectionChanged(props.draft, props.places)) return;
  props.onSubmit({ draftId: props.draft.id, instruction: props.value.trim(), places: props.places });
}

function AdjustmentBody({ props, editing, input }: Readonly<{ props: DraftAdjustmentProps; editing: Editing; input: DraftAdjustmentInputProps }>) {
  const changed = draftSelectionChanged(props.draft, props.places);
  return <><AddPlaces props={props} editing={editing} />
    {!changed ? <p className="text-xs leading-5 text-muted-fg">{itineraryDraftCopy(props.dict.locale).note}</p> : null}
    <DraftAdjustmentInput {...input} />
  </>;
}

/** Edits keep the complete itinerary visible. Proposed places never mutate the source draft. */
export function DraftAdjustment(props: DraftAdjustmentProps) {
  const editing = useDraftPlaceEditing(props), changed = draftSelectionChanged(props.draft, props.places);
  const formId = useId(), inputRef = useRef<HTMLTextAreaElement>(null);
  const input = { ...props, formId, inputRef, canSubmit: props.places.length > 0 && (Boolean(props.value.trim()) || changed), onSubmit: () => { submitAdjustment(props); }, onBack: () => { props.onBack(props.draft.id); } };
  const feedback = changed ? <p className="border-l-2 border-gold pl-3 text-sm leading-6 text-muted-fg">{draftAdjustmentCopy(props.dict.locale).changed}</p> : null;
  const footer = <div className="grid gap-2"><RemovedPlace editing={editing} dict={props.dict} disabled={editing.controls.disabled} /><DraftAdjustmentActions {...input} onWrite={() => { inputRef.current?.focus(); }} /></div>;
  return <section ref={editing.root}><ItineraryDraftDocument draft={draftWithSelection(props.draft, props.places)} dict={props.dict} headingRef={editing.heading} controls={editing.controls} feedback={feedback} footer={footer}><AdjustmentBody props={props} editing={editing} input={input} /></ItineraryDraftDocument></section>;
}
