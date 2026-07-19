/**
 * The only place a renderable しおり photo URL is born (Codex P1-6).
 * Every raw blob passes sanitizePhoto before URL.createObjectURL; a photo
 * that fails sanitization is excluded (fail closed), never passed through.
 */

import { sanitizePhoto, type SanitizePhotoOptions } from "./exifStrip";
import type { SanitizedShioriPhoto, ShioriPhotoInput } from "./types";

export async function ingestShioriPhotos(
  inputs: readonly ShioriPhotoInput[],
  options: SanitizePhotoOptions = {},
): Promise<readonly SanitizedShioriPhoto[]> {
  const settled = await Promise.allSettled(inputs.map((input) => ingestPhoto(input, options)));
  return settled.filter(isFulfilled).map((result) => result.value);
}

export function revokeShioriPhotoUrls(photos: readonly SanitizedShioriPhoto[]): void {
  for (const photo of photos) URL.revokeObjectURL(photo.imageUrl);
}

async function ingestPhoto(
  input: ShioriPhotoInput,
  options: SanitizePhotoOptions,
): Promise<SanitizedShioriPhoto> {
  const blob = await sanitizePhoto(input.photo, options);
  return { ...displayFields(input), blob, imageUrl: URL.createObjectURL(blob) };
}

function displayFields(input: ShioriPhotoInput): Omit<SanitizedShioriPhoto, "blob" | "imageUrl"> {
  const { id, spotName, sceneLabel, capturedAt } = input;
  return { id, spotName, sceneLabel, capturedAt };
}

function isFulfilled(
  result: PromiseSettledResult<SanitizedShioriPhoto>,
): result is PromiseFulfilledResult<SanitizedShioriPhoto> {
  return result.status === "fulfilled";
}
