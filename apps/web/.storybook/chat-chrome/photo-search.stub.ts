import type { PhotoSearchOutcome } from "../../src/features/chat/photo-search";
export * from "../../src/features/chat/photo-search";

/** File selection is real; the isolated preview stays pending without making a request. */
export function postPhotoSearch(): Promise<PhotoSearchOutcome> {
  return new Promise(() => undefined);
}

/** Confirmations are also local-only; no result is presented as server-confirmed. */
export function confirmPhotoSearch(): void {
  return undefined;
}
