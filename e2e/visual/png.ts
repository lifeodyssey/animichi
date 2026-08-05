/**
 * Minimal zero-dependency PNG codec for the visual pipeline (S0-v2 C3).
 * Only what Playwright screenshots need: 8-bit RGBA (colorType 6) and RGB
 * (colorType 2), non-interlaced. Decode unfilters all five scanline filters;
 * encode writes filter-0 rows. Deterministic: same pixels → same bytes.
 */

import { deflateSync, inflateSync } from "node:zlib";

export interface PngImage {
  width: number;
  height: number;
  rgba: Uint8Array;
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

interface PngChunk {
  type: string;
  data: Buffer;
}

function readChunks(bytes: Buffer): PngChunk[] {
  const chunks: PngChunk[] = [];
  let offset = 8;
  while (offset < bytes.length) {
    if (offset + 12 > bytes.length) throw new Error("png: truncated chunk header");
    const length = bytes.readUInt32BE(offset);
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    chunks.push({ type: bytes.toString("ascii", offset + 4, offset + 8), data });
    offset += 12 + length;
  }
  return chunks;
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function unfilter(width: number, height: number, channels: number, raw: Buffer): PngImage {
  const stride = width * channels;
  const rgba = new Uint8Array(width * height * 4);
  const prevRow = new Uint8Array(stride);
  const rowOut = new Uint8Array(stride);
  let offset = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[offset++];
    if (filter > 4) throw new Error(`png: unknown scanline filter ${filter}`);
    const row = raw.subarray(offset, offset + stride);
    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? rowOut[x - channels] : 0;
      const up = y > 0 ? prevRow[x] : 0;
      const upLeft = y > 0 && x >= channels ? prevRow[x - channels] : 0;
      let value = row[x];
      if (filter === 1) value += left;
      else if (filter === 2) value += up;
      else if (filter === 3) value += (left + up) >> 1;
      else if (filter === 4) value += paeth(left, up, upLeft);
      rowOut[x] = value & 0xff;
    }
    const rowBase = y * width * 4;
    for (let x = 0; x < width; x++) {
      const base = rowBase + x * 4;
      for (let c = 0; c < channels; c++) rgba[base + c] = rowOut[x * channels + c];
      if (channels === 3) rgba[base + 3] = 255;
    }
    prevRow.set(rowOut);
    offset += stride;
  }
  return { width, height, rgba };
}

export function decodePng(bytes: Uint8Array): PngImage {
  const buffer = Buffer.from(bytes);
  if (!buffer.subarray(0, 8).equals(PNG_SIGNATURE)) throw new Error("png: bad signature");
  const chunks = readChunks(buffer);
  const ihdr = chunks.find((chunk) => chunk.type === "IHDR");
  const idat = chunks.filter((chunk) => chunk.type === "IDAT").map((chunk) => chunk.data);
  if (!ihdr || idat.length === 0) throw new Error("png: missing IHDR or IDAT");
  const bitDepth = ihdr.data[8];
  const colorType = ihdr.data[9];
  if (bitDepth !== 8 || ihdr.data[12] !== 0) {
    throw new Error(`png: unsupported bitDepth ${bitDepth} interlace ${ihdr.data[12]}`);
  }
  if (colorType !== 2 && colorType !== 6) throw new Error(`png: unsupported colorType ${colorType}`);
  const width = ihdr.data.readUInt32BE(0);
  const height = ihdr.data.readUInt32BE(4);
  const raw = inflateSync(Buffer.concat(idat));
  return unfilter(width, height, colorType === 6 ? 4 : 3, raw);
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

function buildCrcTable(): Uint32Array {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
}

const CRC_TABLE = buildCrcTable();

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export function encodePng(image: PngImage): Uint8Array {
  const { width, height, rgba } = image;
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const idat = deflateSync(raw);
  return Buffer.concat([PNG_SIGNATURE, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
}
