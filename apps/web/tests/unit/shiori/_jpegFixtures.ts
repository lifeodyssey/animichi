/** Byte-level JPEG fixtures shared by the EXIF-strip test files. */

export function segment(marker: number, body: readonly number[]): number[] {
  return [0xff, marker, (body.length + 2) >> 8, (body.length + 2) & 0xff, ...body];
}

export const ascii = (text: string): number[] => Array.from(text, (char) => char.charCodeAt(0));

export const APP0_JFIF = segment(0xe0, [...ascii("JFIF\0"), 1, 2]);
export const APP1_EXIF_GPS = segment(0xe1, ascii("Exif\0\0GPSLAT35.68"));
export const DQT = segment(0xdb, [0, 1, 2, 3]);
export const SOS_HEADER = segment(0xda, [1, 0]);
export const SCAN_TAIL = [...SOS_HEADER, 0xaa, 0xbb, 0xff, 0xd9];

export function makeJpegWithExif(): Uint8Array {
  return Uint8Array.from([0xff, 0xd8, ...APP0_JFIF, ...APP1_EXIF_GPS, ...DQT, ...SCAN_TAIL]);
}

export function makeJpegBlobWithExif(): Blob {
  return new Blob([makeJpegWithExif().slice().buffer], { type: "image/jpeg" });
}

export function makeMalformedJpegBlob(): Blob {
  const truncated = Uint8Array.from([0xff, 0xd8, 0xff, 0xdb, 0xff, 0xff]);
  return new Blob([truncated.slice().buffer], { type: "image/jpeg" });
}

export const bytesToText = (bytes: Uint8Array): string => String.fromCharCode(...bytes);
