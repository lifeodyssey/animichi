import { useRef, useState } from "react";
import type { ChangeEvent } from "react";
import type { ChatDict } from "../../src/features/chat/i18n";
import { PhotoAttachmentCard } from "../../src/features/chat/components/PhotoAttachmentCard";
import { PhotoSearchUpload } from "../../src/features/chat/components/PhotoSearchUpload";
import type { PhotoUploadState } from "../../src/features/chat/photo-upload-state";
import { usePhotoPreview, usePhotoUpload } from "../../src/features/chat/use-photo-upload";
import { parsePart, searchPart } from "../chat-cards/fixtures";

export const PHOTO_PREVIEW_WIDTH = "w-[min(452px,calc(100vw_-_80px))] max-w-full";
export const PHOTO_SOURCE = "/images/landing/suga-shrine-anime-source.webp";
const CLARIFY = parsePart({ intent: "clarify", success: true, status: "ok", data: { reason: "photo_unrecognized", candidates: [] } });
export const PHOTO_STATES = {
  uploading: { kind: "uploading" },
  done: { kind: "done", offerId: "storybook-photo", part: parsePart(searchPart) },
  clarify: { kind: "done", offerId: "storybook-photo", part: CLARIFY },
  failed: { kind: "error", error: "failed" },
  unsupported: { kind: "error", error: "unsupported" },
  tooLarge: { kind: "error", error: "tooLarge" },
  challenge: { kind: "error", error: "challenge" },
  quota: { kind: "quota", guidance: "configure_vision_key" },
  vision: { kind: "quota", guidance: "switch_vision_endpoint" },
} as const satisfies Readonly<Record<string, PhotoUploadState>>;

type PreviewProps = Readonly<{ dict: ChatDict; state: PhotoUploadState; name?: string; src?: string }>;

function fileChange(upload: (file: File) => void) {
  return (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) upload(file);
  };
}

function usePreviewAttachment(props: PreviewProps) {
  const [fixture, setFixture] = useState<PhotoUploadState | null>(props.state), live = usePhotoUpload("/storybook", { locale: props.dict.locale });
  const liveSrc = usePhotoPreview(live.attachment?.file);
  const state = live.attachment?.state ?? fixture, name = live.attachment?.file.name ?? props.name ?? "scene-01.webp";
  const retry = () => { if (live.attachment) { live.retry(); return; } setFixture({ kind: "uploading" }); };
  const remove = () => { live.remove(); setFixture(null); };
  return { ...live, state, name, src: live.attachment ? liveSrc : props.src, retry, remove };
}

/** Fixture outcomes are explicit. Retry/replacement enters waiting and never fakes recognition. */
export function PhotoAttachmentPreview(props: PreviewProps) {
  const model = usePreviewAttachment(props), input = useRef<HTMLInputElement>(null);
  if (!model.state) return <div className={PHOTO_PREVIEW_WIDTH}><PhotoSearchUpload dict={props.dict} baseUrl="/storybook" context={{ locale: props.dict.locale }} /></div>;
  return <div className={`${PHOTO_PREVIEW_WIDTH} grid gap-2`}>
    <PhotoAttachmentCard dict={props.dict} name={model.name} src={model.src} state={model.state} onRetry={model.retry} onRemove={model.remove} onReplace={() => { input.current?.click(); }} />
    <input ref={input} type="file" hidden tabIndex={-1} aria-label={props.dict.photo.upload} accept="image/jpeg,image/png,image/webp" onChange={fileChange(model.upload)} disabled={model.state.kind === "uploading"} />
    <p className="px-1 text-xs leading-5 text-muted-fg">{props.dict.photo.processedNote}</p>
  </div>;
}
