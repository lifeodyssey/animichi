import { Button } from "animal-island-ui-tailwind/button";
import { useState } from "react";
import type { ChatDict } from "../i18n";
import { photoAttachmentCopy } from "../photo-attachment-copy";
import { canRetryPhoto } from "../photo-upload-state";
import type { PhotoUploadState } from "../photo-upload-state";
import { ProgressGlyph } from "./ProgressGlyph";
import { ScenePreview } from "./ScenePreview";

export type PhotoAttachmentCardProps = Readonly<{
  dict: ChatDict; name: string; src?: string; state: PhotoUploadState;
  onRetry: () => void; onReplace: () => void; onRemove: () => void;
}>;

const ACTION = "[min-height:44px]! [height:auto]! [padding:8px_12px]! [font-size:13px]! [line-height:1.4]! focus-visible:outline-primary-strong motion-reduce:transition-none";
const QUIET = "[--animal-text-color:var(--color-muted-fg)] [--animal-bg-color-secondary:var(--color-muted)]";
const THUMBNAIL = "aspect-[4/3] [width:96px] max-[420px]:[width:80px] shrink-0 rounded-xl bg-muted";

export function PhotoGlyph({ kind = "image" }: Readonly<{ kind?: "image" | "expand" | "close" }>) {
  const paths = { image: "M4 4h16v16H4zM4 16l5-5 4 4 3-3 4 4M15 8h.01", expand: "M14 4h6v6M20 4l-7 7M10 20H4v-6M4 20l7-7", close: "m6 6 12 12M18 6 6 18" };
  return <svg className="size-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d={paths[kind]} /></svg>;
}

function PhotoThumbnail({ src, name, dict }: Pick<PhotoAttachmentCardProps, "src" | "name" | "dict">) {
  const [open, setOpen] = useState(false), [failed, setFailed] = useState(false), copy = photoAttachmentCopy(dict.locale);
  if (!src || failed) return <div className={`grid place-items-center text-muted-fg ${THUMBNAIL}`} aria-hidden="true"><PhotoGlyph /></div>;
  return <>
    <button type="button" aria-label={`${copy.preview}: ${name}`} onClick={() => { setOpen(true); }} className={`group relative cursor-zoom-in overflow-hidden focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary-strong ${THUMBNAIL}`}>
      <img src={src} alt="" className="size-full object-cover" onError={() => { setFailed(true); }} /><span className="absolute bottom-1 right-1 grid size-6 place-items-center rounded-md bg-paper/90 text-fg"><PhotoGlyph kind="expand" /></span>
    </button>
    {open ? <ScenePreview src={src} name={name} closeLabel={dict.search.closePreview} failureMessage={dict.search.sceneUnavailable} onClose={() => { setOpen(false); }} /> : null}
  </>;
}

function feedback(props: PhotoAttachmentCardProps): string {
  const { state, dict } = props, copy = photoAttachmentCopy(dict.locale);
  if (state.kind === "uploading") return dict.photo.uploading;
  if (state.kind === "done") return state.part.intent === "clarify" ? copy.clarify : copy.received;
  if (state.kind === "quota") return state.guidance === "switch_vision_endpoint" ? dict.photo.quotaByokNoVision : dict.photo.quotaNoByok;
  return state.error === "challenge" ? dict.turnstile.failed : dict.photo[state.error];
}

function hasDetail(state: PhotoUploadState): boolean {
  return state.kind === "quota" || (state.kind === "error" && state.error !== "failed");
}

function feedbackHeading(props: PhotoAttachmentCardProps): string {
  const { state } = props, copy = photoAttachmentCopy(props.dict.locale);
  if (state.kind === "quota") return copy.quota;
  if (state.kind === "error" && state.error !== "failed") return copy[state.error];
  return feedback(props);
}

function AttachmentFeedback(props: PhotoAttachmentCardProps) {
  const { state } = props, busy = state.kind === "uploading", failed = state.kind === "error" || state.kind === "quota";
  const tone = failed ? "text-fg" : "text-primary-strong", kind = busy ? "running" : "done";
  const role = failed ? "alert" : "status";
  return <div role={hasDetail(state) ? undefined : role} aria-atomic="true" className="min-w-0">
    <p className={`flex items-start gap-2 text-sm font-semibold leading-6 ${tone}`}>{failed ? null : <span className="pt-1"><ProgressGlyph kind={kind} /></span>}<span className="min-w-0 [overflow-wrap:anywhere]">{feedbackHeading(props)}</span></p>
  </div>;
}

function AttachmentActions(props: PhotoAttachmentCardProps) {
  const copy = photoAttachmentCopy(props.dict.locale), busy = props.state.kind === "uploading";
  if (busy || props.state.kind === "quota") return null;
  return <div className="flex flex-wrap items-center gap-x-1 gap-y-2 pt-1">
    {canRetryPhoto(props.state) ? <Button htmlType="button" type="primary" onClick={props.onRetry} className={`${ACTION} [--animal-bg-color:var(--color-primary-soft)] [--animal-text-color:var(--color-primary-strong)]`}>{props.dict.photo.retry}</Button> : null}
    <Button htmlType="button" type="text" className={`${ACTION} ${QUIET}`} onClick={props.onReplace}>{copy.replace}</Button>
  </div>;
}

function RemoveAttachment(props: PhotoAttachmentCardProps) {
  if (props.state.kind === "uploading") return null;
  const label = photoAttachmentCopy(props.dict.locale).remove;
  return <Button htmlType="button" type="text" aria-label={label} title={label} onClick={props.onRemove} className={`absolute right-0.5 top-0.5 [width:44px]! [min-height:44px]! [padding:0]! ${QUIET} focus-visible:outline-primary-strong motion-reduce:transition-none`} icon={<PhotoGlyph kind="close" />} />;
}

/** One retained image; recognition results keep using the shared result cards below. */
export function PhotoAttachmentCard(props: PhotoAttachmentCardProps) {
  const detailed = hasDetail(props.state);
  return <section aria-label={photoAttachmentCopy(props.dict.locale).region} className="relative grid w-full max-w-[480px] gap-3 rounded-[20px] border border-border-soft bg-paper p-3.5 text-fg">
    <div className="flex items-center gap-3.5"><PhotoThumbnail key={`${props.name}:${props.src ?? ""}`} {...props} />
      <div className="grid min-w-0 flex-1 gap-1 pr-5"><p className="truncate text-xs leading-5 text-muted-fg" title={props.name}>{props.name}</p><AttachmentFeedback {...props} />{detailed ? null : <AttachmentActions {...props} />}</div>
    </div>
    {detailed ? <div className="grid gap-1"><p role="alert" className="text-sm leading-6 text-muted-fg [overflow-wrap:anywhere]">{feedback(props)}</p><AttachmentActions {...props} /></div> : null}<RemoveAttachment {...props} />
  </section>;
}
