/**
 * EXIF stripping for photos entering the しおり pipeline (X6 hard AC).
 * Default = strip; retaining metadata is an explicit opt-in.
 *
 * JPEG: lossless APPn/COM removal via a fail-closed segment walker that
 * validates marker prefixes, segment lengths, byte stuffing, every scan
 * (progressive included) and the EOI; malformed input is rejected, never
 * passed through. Trailer bytes after EOI are discarded. Selection note:
 * no maintained browser-grade lossless stripper exists on npm (exif-be-gone
 * is Node-stream based; piexifjs/exifremove are unmaintained and naive), and
 * canvas re-encode is lossy for JPEG, so the walker stays hand-written but
 * strict. Other formats: canvas redraw, which drops all metadata.
 */

const SOI = 0xffd8;
const EOI = 0xffd9;
const SOS = 0xffda;
const TEM = 0xff01;
const RST0 = 0xffd0;
const RST7 = 0xffd7;
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

interface JpegWalk {
  bytes: Uint8Array;
  view: DataView;
  offset: number;
  sawScan: boolean;
  kept: Uint8Array[];
}

/** Removes APPn (except APP0/JFIF) + COM segments everywhere, incl. between scans. */
export function stripJpegMetadata(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const walk = startWalk(bytes);
  while (readMarker(walk) !== EOI) stripNextSegment(walk);
  finishAtEoi(walk);
  return concatBytes(walk.kept);
}

function startWalk(bytes: Uint8Array): JpegWalk {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 4 || view.getUint16(0) !== SOI) throw new Error("not a JPEG");
  return { bytes, view, offset: 2, sawScan: false, kept: [bytes.subarray(0, 2)] };
}

function readMarker(walk: JpegWalk): number {
  if (walk.offset + 2 > walk.bytes.length) throw new Error("truncated JPEG: missing EOI");
  if (walk.bytes[walk.offset] !== 0xff) throw new Error("invalid JPEG: bad marker prefix");
  return walk.view.getUint16(walk.offset);
}

function stripNextSegment(walk: JpegWalk): void {
  const marker = readMarker(walk);
  if (isStandalone(marker)) throw new Error("invalid JPEG: unexpected standalone marker");
  const end = segmentEnd(walk);
  if (marker === SOS) {
    keepScan(walk, end);
    return;
  }
  keepOrDropSegment(walk, marker, end);
}

function isStandalone(marker: number): boolean {
  return marker === SOI || marker === TEM || (marker >= RST0 && marker <= RST7);
}

function segmentEnd(walk: JpegWalk): number {
  if (walk.offset + 4 > walk.bytes.length) throw new Error("truncated JPEG segment");
  const length = walk.view.getUint16(walk.offset + 2);
  if (length < 2) throw new Error("invalid JPEG: segment length too small");
  const end = walk.offset + 2 + length;
  if (end > walk.bytes.length) throw new Error("truncated JPEG segment");
  return end;
}

function keepOrDropSegment(walk: JpegWalk, marker: number, end: number): void {
  if (!isMetadataMarker(marker)) walk.kept.push(walk.bytes.subarray(walk.offset, end));
  walk.offset = end;
}

function isMetadataMarker(marker: number): boolean {
  return (marker > APP0 && marker <= APP15) || marker === COM;
}

function keepScan(walk: JpegWalk, headerEnd: number): void {
  const dataEnd = entropyEnd(walk.bytes, headerEnd);
  walk.kept.push(walk.bytes.subarray(walk.offset, dataEnd));
  walk.offset = dataEnd;
  walk.sawScan = true;
}

function entropyEnd(bytes: Uint8Array, from: number): number {
  for (let i = from; i + 1 < bytes.length; i += 1) {
    if (bytes[i] === 0xff && !isEntropyContinuation(bytes[i + 1])) return i;
  }
  throw new Error("truncated JPEG: unterminated scan");
}

function isEntropyContinuation(byteAfterFf: number | undefined): boolean {
  if (byteAfterFf === undefined) return false;
  if (byteAfterFf === 0x00 || byteAfterFf === 0xff) return true;
  return byteAfterFf >= 0xd0 && byteAfterFf <= 0xd7;
}

function finishAtEoi(walk: JpegWalk): void {
  if (!walk.sawScan) throw new Error("invalid JPEG: no scan data");
  walk.kept.push(walk.bytes.subarray(walk.offset, walk.offset + 2));
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
