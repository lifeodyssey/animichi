import type { ChatDataPart } from "@animichi/contract";
import type { PhotoGuidance } from "./photo-search";

export type PhotoUploadError = "unsupported" | "tooLarge" | "failed" | "challenge";
export type PhotoUploadState =
  | Readonly<{ kind: "uploading" }>
  | Readonly<{ kind: "error"; error: PhotoUploadError }>
  | Readonly<{ kind: "quota"; guidance: PhotoGuidance }>
  | Readonly<{ kind: "done"; part: ChatDataPart; offerId: string }>;

export type PhotoAttachment = Readonly<{ file: File; state: PhotoUploadState }>;

export function canRetryPhoto(state: PhotoUploadState): boolean {
  return state.kind === "error" && (state.error === "failed" || state.error === "challenge");
}
