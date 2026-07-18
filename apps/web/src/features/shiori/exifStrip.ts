/**
 * EXIF stripping for photos entering the しおり pipeline (X6 hard AC).
 * Default = strip; retaining metadata is an explicit opt-in.
 *
 * JPEG: lossless APPn/COM segment removal (no re-encode, no quality loss,
 * deterministic and unit-verifiable). Other formats: canvas redraw, which
 * drops all metadata during re-encode.
 */

const SOI = 0xffd8;
const SOS = 0xffda;
const APP0 = 0xffe0;
const APP15 = 0xffef;
const COM = 0xfffe;

export interface SanitizePhotoOptions {
  retainExif?: boolean;
}

export async function sanitizePhoto(
  photo: Blob,
  options: SanitizePhotoOptions = {},
): Promise<Blob> {
  if (options.retainExif) return photo;
  if (photo.type === "image/jpeg") return stripJpegBlob(photo);
  return redrawWithoutMetadata(photo);
}

/** Removes APP1–APP15 + COM segments; keeps APP0 (JFIF), tables and scan data intact. */
export function stripJpegMetadata(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const view = toView(bytes);
  if (bytes.length < 2 || view.getUint16(0) !== SOI) throw new Error("not a JPEG");
  const kept: Uint8Array[] = [bytes.subarray(0, 2)];
  kept.push(collectKeptSegments(bytes, view, kept));
  return concatBytes(kept);
}

function toView(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function collectKeptSegments(bytes: Uint8Array, view: DataView, kept: Uint8Array[]): Uint8Array {
  let offset = 2;
  while (offset + 4 <= bytes.length && view.getUint16(offset) !== SOS) {
    const end = segmentEnd(bytes, view, offset);
    if (!isMetadataMarker(view.getUint16(offset))) kept.push(bytes.subarray(offset, end));
    offset = end;
  }
  return bytes.subarray(offset);
}

function segmentEnd(bytes: Uint8Array, view: DataView, offset: number): number {
  const end = offset + 2 + view.getUint16(offset + 2);
  if (end > bytes.length) throw new Error("truncated JPEG segment");
  return end;
}

function isMetadataMarker(marker: number): boolean {
  return (marker > APP0 && marker <= APP15) || marker === COM;
}

function concatBytes(parts: readonly Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

async function stripJpegBlob(photo: Blob): Promise<Blob> {
  const bytes = new Uint8Array(await photo.arrayBuffer());
  return new Blob([stripJpegMetadata(bytes)], { type: "image/jpeg" });
}

async function redrawWithoutMetadata(photo: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(photo);
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("2d canvas context unavailable");
  context.drawImage(bitmap, 0, 0);
  return canvas.convertToBlob({ type: photo.type });
}
