import { describe, expect, it } from "vitest";
import { stripJpegMetadata } from "../../../src/features/shiori/exifStrip";
import { APP1_EXIF_GPS, bytesToText, DQT, segment, SOS_HEADER } from "./_jpegFixtures";

const EOI = [0xff, 0xd9];
const SCAN_WITH_STUFFING = [...SOS_HEADER, 0xaa, 0xff, 0x00, 0xbb];
const RST0 = [0xff, 0xd0];

const jpeg = (...parts: readonly (readonly number[])[]): Uint8Array =>
  Uint8Array.from([0xff, 0xd8, ...parts.flat()]);

describe("stripJpegMetadata fail-closed hardening", () => {
  it("strips an APP1 segment inserted after a scan, before EOI", () => {
    const input = jpeg(DQT, SCAN_WITH_STUFFING, APP1_EXIF_GPS, EOI);

    const stripped = stripJpegMetadata(input);

    expect(bytesToText(stripped)).not.toContain("GPSLAT");
    expect([...stripped]).toEqual([...jpeg(DQT, SCAN_WITH_STUFFING, EOI)]);
  });

  it("strips metadata between the scans of a progressive JPEG", () => {
    const secondScan = [...SOS_HEADER, 0xcc];
    const input = jpeg(DQT, SCAN_WITH_STUFFING, APP1_EXIF_GPS, secondScan, EOI);

    const stripped = stripJpegMetadata(input);

    expect([...stripped]).toEqual([...jpeg(DQT, SCAN_WITH_STUFFING, secondScan, EOI)]);
  });

  it("keeps stuffed 0xFF00 bytes and restart markers inside scan data", () => {
    const scan = [...SOS_HEADER, 0xff, 0x00, ...RST0, 0xee];
    const input = jpeg(DQT, scan, EOI);

    expect([...stripJpegMetadata(input)]).toEqual([...input]);
  });

  it("rejects a zero-length segment instead of resyncing on later bytes", () => {
    const zeroLength = [0xff, 0xe1, 0x00, 0x00];
    const input = jpeg(zeroLength, DQT, SCAN_WITH_STUFFING, EOI);

    expect(() => stripJpegMetadata(input)).toThrow("segment length");
  });

  it("rejects a one-byte segment length", () => {
    const oneByteLength = [0xff, 0xe1, 0x00, 0x01];
    const input = jpeg(oneByteLength, DQT, SCAN_WITH_STUFFING, EOI);

    expect(() => stripJpegMetadata(input)).toThrow("segment length");
  });

  it("rejects bytes without a 0xFF marker prefix between segments", () => {
    const input = jpeg(DQT, [0x00, 0xe1], SCAN_WITH_STUFFING, EOI);

    expect(() => stripJpegMetadata(input)).toThrow("marker prefix");
  });

  it("rejects a standalone restart marker outside scan data", () => {
    const input = jpeg(RST0, DQT, SCAN_WITH_STUFFING, EOI);

    expect(() => stripJpegMetadata(input)).toThrow("standalone marker");
  });

  it("rejects scan data that ends without any terminating marker", () => {
    const input = jpeg(DQT, [...SOS_HEADER, 0xaa, 0xbb]);

    expect(() => stripJpegMetadata(input)).toThrow("unterminated scan");
  });

  it("rejects a JPEG that reaches EOI without any scan", () => {
    const input = jpeg(DQT, EOI);

    expect(() => stripJpegMetadata(input)).toThrow("no scan");
  });

  it("discards trailer bytes appended after EOI", () => {
    const clean = jpeg(DQT, SCAN_WITH_STUFFING, EOI);
    const input = Uint8Array.from([...clean, ...segment(0xe1, [0x99])]);

    expect([...stripJpegMetadata(input)]).toEqual([...clean]);
  });
});

describe("stripJpegMetadata fill-byte tolerance", () => {
  it("accepts legal 0xFF fill bytes padding a marker between segments", () => {
    const input = jpeg(DQT, [0xff], SCAN_WITH_STUFFING, EOI);

    expect([...stripJpegMetadata(input)]).toEqual([...jpeg(DQT, SCAN_WITH_STUFFING, EOI)]);
  });

  it("still strips a metadata segment padded with fill bytes", () => {
    const input = jpeg(DQT, [0xff, 0xff], APP1_EXIF_GPS, SCAN_WITH_STUFFING, EOI);

    expect(bytesToText(stripJpegMetadata(input))).not.toContain("GPSLAT");
  });
});
