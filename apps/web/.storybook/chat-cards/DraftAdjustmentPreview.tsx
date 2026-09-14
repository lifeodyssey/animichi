import { useState } from "react";
import { DraftAdjustment } from "../../src/features/chat/components/DraftAdjustment";
import type { DraftAdjustmentProps } from "../../src/features/chat/components/DraftAdjustment";
import type { DraftAdjustmentRequest } from "../../src/features/chat/lib/draft-adjustment";
import type { SelectedPlace } from "../../src/features/chat/lib/selected-places";
import { ItineraryDraft } from "../../src/features/chat/components/ItineraryDraft";
import { draftAdjustmentCopy } from "../../src/features/chat/draft-adjustment-copy";

export type DraftAdjustmentPreviewProps = DraftAdjustmentProps & Readonly<{ onSave: (draftId: string) => void; startEditing?: boolean }>;

function useDraftPreview(props: DraftAdjustmentPreviewProps) {
  const [value, setValue] = useState(props.value);
  const [places, setPlaces] = useState(props.places), [editing, setEditing] = useState(props.startEditing ?? true);
  const [submitted, setSubmitted] = useState(false);
  const onChange = (next: string) => { setValue(next); props.onChange(next); };
  const onPlacesChange = (next: readonly SelectedPlace[]) => { setPlaces(next); props.onPlacesChange(next); };
  const onSubmit = (request: DraftAdjustmentRequest) => { props.onSubmit(request); setSubmitted(true); };
  const onBack = (draftId: string) => { props.onBack(draftId); setEditing(false); };
  return { value, places, submitted, editing, onChange, onPlacesChange, onSubmit, onBack, resume: () => { setEditing(true); } };
}

function OriginalDraft({ props, preview }: Readonly<{ props: DraftAdjustmentPreviewProps; preview: ReturnType<typeof useDraftPreview> }>) {
  const copy = draftAdjustmentCopy(props.dict.locale);
  const status = preview.submitted ? "updating" : props.status;
  return <div className="grid gap-4">{status === "updating" || status === "failed" ? <p role="status" className="text-sm leading-6 text-muted-fg">{status === "updating" ? copy.pending : copy.failed}</p> : null}<ItineraryDraft draft={props.draft} dict={props.dict} onSave={props.onSave} onAdjust={preview.resume} /></div>;
}

export function DraftAdjustmentPreview(props: DraftAdjustmentPreviewProps) {
  const preview = useDraftPreview(props);
  const content = preview.editing ? <DraftAdjustment {...props} {...preview} status={preview.submitted ? "updating" : props.status} /> : <OriginalDraft props={props} preview={preview} />;
  return <div style={{ width: "min(480px, calc(100vw - 80px))", maxWidth: "100%" }}>{content}</div>;
}
