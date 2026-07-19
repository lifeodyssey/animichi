import { afterEach, describe, expect, it, vi } from "vitest";
import { sanitizePhoto, stripJpegMetadata } from "../../../src/features/shiori/exifStrip";
import {
  APP0_JFIF,
  ascii,
  bytesToText,
  DQT,
  makeJpegWithExif,
  SCAN_TAIL,
  segment,
} from "./_jpegFixtures";

describe("stripJpegMetadata", () => {
  it("removes the EXIF APP1 segment including GPS payload", () => {
    const stripped = stripJpegMetadata(makeJpegWithExif());

    expect(bytesToText(stripped)).not.toContain("Exif");
    expect(bytesToText(stripped)).not.toContain("GPSLAT");
  });

  it("keeps the JFIF header, tables and scan data byte-for-byte", () => {
    const stripped = stripJpegMetadata(makeJpegWithExif());

    expect([...stripped]).toEqual([0xff, 0xd8, ...APP0_JFIF, ...DQT, ...SCAN_TAIL]);
  });

  it("removes comment segments alongside APPn metadata", () => {
    const jpeg = Uint8Array.from([
      0xff, 0xd8, ...segment(0xfe, ascii("shot on phone")), ...DQT, ...SCAN_TAIL,
    ]);

    expect([...stripJpegMetadata(jpeg)]).toEqual([0xff, 0xd8, ...DQT, ...SCAN_TAIL]);
  });

  it("rejects bytes that are not a JPEG", () => {
    expect(() => stripJpegMetadata(Uint8Array.from(ascii("PNG?")))).toThrow("not a JPEG");
  });

  it("rejects a truncated segment instead of looping past the end", () => {
    const truncated = Uint8Array.from([0xff, 0xd8, 0xff, 0xdb, 0xff, 0xff]);

    expect(() => stripJpegMetadata(truncated)).toThrow("truncated JPEG");
  });
});

describe("sanitizePhoto", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("strips EXIF from JPEG photos by default", async () => {
    const photo = new Blob([makeJpegWithExif().slice().buffer], { type: "image/jpeg" });

    const sanitized = await sanitizePhoto(photo);

    const bytes = new Uint8Array(await sanitized.arrayBuffer());
    expect(bytesToText(bytes)).not.toContain("GPSLAT");
    expect(sanitized.type).toBe("image/jpeg");
  });

  it("returns the original photo only when retaining EXIF is opted in", async () => {
    const photo = new Blob([makeJpegWithExif().slice().buffer], { type: "image/jpeg" });

    const retained = await sanitizePhoto(photo, { retainExif: true });

    expect(retained).toBe(photo);
  });

  it("redraws non-JPEG photos on a canvas to drop metadata", async () => {
    const redrawn = new Blob(["clean"], { type: "image/png" });
    const convertToBlob = vi.fn().mockResolvedValue(redrawn);
    const drawImage = vi.fn();
    vi.stubGlobal("createImageBitmap", vi.fn().mockResolvedValue({ width: 4, height: 3 }));
    vi.stubGlobal(
      "OffscreenCanvas",
      class {
        getContext = () => ({ drawImage });
        convertToBlob = convertToBlob;
      },
    );

    const sanitized = await sanitizePhoto(new Blob(["png-with-eXIf"], { type: "image/png" }));

    expect(sanitized).toBe(redrawn);
    expect(drawImage).toHaveBeenCalledWith({ width: 4, height: 3 }, 0, 0);
    expect(convertToBlob).toHaveBeenCalledWith({ type: "image/png" });
  });

  it("fails loudly when the canvas context is unavailable", async () => {
    vi.stubGlobal("createImageBitmap", vi.fn().mockResolvedValue({ width: 4, height: 3 }));
    vi.stubGlobal(
      "OffscreenCanvas",
      class {
        getContext = () => null;
      },
    );

    await expect(sanitizePhoto(new Blob(["x"], { type: "image/webp" }))).rejects.toThrow(
      "2d canvas context unavailable",
    );
  });
});
