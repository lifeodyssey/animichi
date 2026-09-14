import type { ChatDataPart } from "@animichi/contract";
import { Button } from "animal-island-ui-tailwind/button";
import { useRef } from "react";
import type { ChangeEvent, ReactNode, RefObject } from "react";
import { useChatActions } from "../ChatActions";
import type { ChatDict } from "../i18n";
import { photoAttachmentCopy } from "../photo-attachment-copy";
import type { PhotoSearchContext } from "../photo-search";
import type { PhotoAttachment } from "../photo-upload-state";
import { usePhotoPreview, usePhotoUpload } from "../use-photo-upload";
import { photoOfferPick } from "../selection/photo-offer-pick";
import type { PhotoOffer } from "../selection/photo-offer-pick";
import { ClarifyPickProvider, useClarifyPick } from "../selection/use-clarify-pick";
import { DataPartCard } from "./DataPartCard";
import { PhotoAttachmentCard } from "./PhotoAttachmentCard";

type Props = Readonly<{
  dict: ChatDict; baseUrl: string; context: PhotoSearchContext; iconTrigger?: boolean;
  children?: (slots: Readonly<{ control: ReactNode; outcome: ReactNode }>) => ReactNode;
}>;

type ControlProps = Readonly<{
  dict: ChatDict; iconTrigger: boolean; busy: boolean; attached: boolean;
  inputRef: RefObject<HTMLInputElement | null>; onChange: (event: ChangeEvent<HTMLInputElement>) => void;
}>;

const ICON_TRIGGER_CLASS = "size-11 min-h-11 shrink-0 border-0 p-0 text-fg [--animal-text-color:var(--color-fg)] [--animal-bg-color-secondary:var(--color-muted)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-strong motion-reduce:transition-none";

function CameraIcon() {
  return <svg className="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d="M8 6 9.5 4h5L16 6h3a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z" /><circle cx="12" cy="13" r="3.5" /></svg>;
}

function TrayTrigger({ dict, onChoose }: Readonly<{ dict: ChatDict; onChoose: () => void }>) {
  return <div className="grid justify-items-start gap-2">
    <Button htmlType="button" type="default" icon={<CameraIcon />} onClick={onChoose} className="[min-height:44px]! [padding:10px_16px]! [font-size:14px]! [--animal-bg-color:var(--color-paper)] [--animal-text-color:var(--color-fg)] [--animal-border-color:var(--color-border-soft)] focus-visible:outline-primary-strong motion-reduce:transition-none">{dict.photo.upload}</Button>
    <p className="text-xs leading-5 text-muted-fg">{photoAttachmentCopy(dict.locale).formats}</p>
    <p className="text-xs leading-5 text-muted-fg">{dict.photo.processedNote}</p>
  </div>;
}

function UploadControl({ dict, iconTrigger, busy, attached, inputRef, onChange }: ControlProps) {
  const choosePhoto = () => { inputRef.current?.click(); };
  const input = <input ref={inputRef} type="file" hidden tabIndex={-1} accept="image/jpeg,image/png,image/webp" aria-label={dict.photo.upload} onChange={onChange} disabled={busy} />;
  if (iconTrigger) return <><Button htmlType="button" type="text" className={ICON_TRIGGER_CLASS} aria-label={dict.photo.upload} title={dict.photo.upload} icon={<CameraIcon />} onClick={choosePhoto} disabled={busy} />{input}</>;
  return <>{attached ? null : <TrayTrigger dict={dict} onChoose={choosePhoto} />}{input}</>;
}

function makeFileChange(upload: (file: File) => void) {
  return (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) upload(file);
  };
}

/** Photo candidates confirm their server-issued offer, never a session clarification. */
function PhotoResult({ dict, offer, part }: Readonly<{ dict: ChatDict; offer: PhotoOffer; part: ChatDataPart }>) {
  const { send } = useChatActions();
  const { sendable } = useClarifyPick();
  return <ClarifyPickProvider turn={photoOfferPick(offer, send, sendable)}><DataPartCard data={part} dict={dict} /></ClarifyPickProvider>;
}

type OutcomeProps = Readonly<{
  dict: ChatDict; baseUrl: string; context: PhotoSearchContext; attachment: PhotoAttachment | null; src?: string;
  onRetry: () => void; onReplace: () => void; onRemove: () => void;
}>;

function UploadOutcome(props: OutcomeProps) {
  const { attachment, dict, baseUrl, context } = props;
  if (!attachment) return null;
  const { state, file } = attachment;
  return <div className="grid min-w-0 gap-4">
    <div className="grid justify-items-start gap-2"><PhotoAttachmentCard {...props} name={file.name} state={state} /><p className="px-1 text-xs leading-5 text-muted-fg">{dict.photo.processedNote}</p></div>
    {state.kind === "done" ? <PhotoResult key={state.offerId} dict={dict} offer={{ baseUrl, offerId: state.offerId, context }} part={state.part} /> : null}
  </div>;
}

export function PhotoSearchUpload({ dict, baseUrl, context, iconTrigger = false, children }: Props) {
  const { attachment, upload, retry, remove, busy } = usePhotoUpload(baseUrl, context);
  const inputRef = useRef<HTMLInputElement>(null), src = usePhotoPreview(attachment?.file);
  const control = <UploadControl dict={dict} iconTrigger={iconTrigger} inputRef={inputRef} busy={busy} attached={attachment !== null} onChange={makeFileChange(upload)} />;
  const outcome = <UploadOutcome dict={dict} baseUrl={baseUrl} context={context} attachment={attachment} src={src} onRetry={retry} onReplace={() => { inputRef.current?.click(); }} onRemove={remove} />;
  if (children) return <>{children({ control, outcome })}</>;
  return <div className="grid min-w-0 gap-3">{control}{outcome}</div>;
}
