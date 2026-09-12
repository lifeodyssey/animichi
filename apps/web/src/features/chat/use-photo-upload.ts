import { useEffect, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";
import { PHOTO_CHALLENGED, isOversizedPhoto, isSupportedPhoto, postPhotoSearch } from "./photo-search";
import type { PhotoSearchContext, PhotoSearchOutcome } from "./photo-search";
import { canRetryPhoto } from "./photo-upload-state";
import type { PhotoAttachment, PhotoUploadError, PhotoUploadState } from "./photo-upload-state";

type Lifetime = RefObject<{ active: boolean; busy: boolean }>;
type UploadOptions = Readonly<{ baseUrl: string; context: PhotoSearchContext; lifetime: Lifetime; setAttachment: (value: PhotoAttachment | null) => void }>;

function preflightError(file: File): PhotoUploadError | null {
  if (!isSupportedPhoto(file)) return "unsupported";
  if (isOversizedPhoto(file)) return "tooLarge";
  return null;
}

function settledState(outcome: PhotoSearchOutcome): PhotoUploadState {
  return outcome.kind === "quota" ? outcome : { kind: "done", part: outcome.part, offerId: outcome.offerId };
}

function failureState(cause: unknown): PhotoUploadState {
  const error = cause instanceof Error && cause.message === PHOTO_CHALLENGED ? "challenge" : "failed";
  return { kind: "error", error };
}

function settleUpload(options: UploadOptions, file: File, state: PhotoUploadState): void {
  options.lifetime.current.busy = false;
  if (options.lifetime.current.active) options.setAttachment({ file, state });
}

function requestPhoto(options: UploadOptions, file: File): void {
  void postPhotoSearch(options.baseUrl, file, options.context).then(
    (outcome) => { settleUpload(options, file, settledState(outcome)); },
    (cause: unknown) => { settleUpload(options, file, failureState(cause)); },
  );
}

function uploadFile(options: UploadOptions, file: File): void {
  if (options.lifetime.current.busy) return;
  const error = preflightError(file);
  if (error) { options.setAttachment({ file, state: { kind: "error", error } }); return; }
  options.lifetime.current.busy = true;
  options.setAttachment({ file, state: { kind: "uploading" } });
  requestPhoto(options, file);
}

function useUploadLifetime(): Lifetime {
  const lifetime = useRef({ active: true, busy: false });
  useEffect(() => {
    const current = lifetime.current;
    current.active = true;
    return () => { current.active = false; };
  }, []);
  return lifetime;
}

/** Retain the source for real retries; lock replacement until this request settles. */
export function usePhotoUpload(baseUrl: string, context: PhotoSearchContext) {
  const [attachment, setAttachment] = useState<PhotoAttachment | null>(null);
  const lifetime = useUploadLifetime();
  const upload = useMemo(() => (file: File) => { uploadFile({ baseUrl, context, lifetime, setAttachment }, file); }, [baseUrl, context, lifetime]);
  const retry = () => { if (attachment && canRetryPhoto(attachment.state)) upload(attachment.file); };
  const remove = () => { if (!lifetime.current.busy) setAttachment(null); };
  return { attachment, upload, retry, remove, busy: attachment?.state.kind === "uploading" };
}

function previewUrl(file?: File): string | undefined {
  if (!file || preflightError(file) || typeof URL.createObjectURL !== "function") return undefined;
  return URL.createObjectURL(file);
}

/** Local-only URLs live exactly as long as the retained attachment. */
export function usePhotoPreview(file?: File): string | undefined {
  const [preview, setPreview] = useState<Readonly<{ file?: File; src?: string }>>({});
  useEffect(() => {
    const src = previewUrl(file);
    setPreview({ file, src });
    return () => { if (src) URL.revokeObjectURL(src); };
  }, [file]);
  return preview.file === file ? preview.src : undefined;
}
