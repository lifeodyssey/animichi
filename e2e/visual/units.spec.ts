/**
 * Unit tests for the pure modules of the visual pipeline (S0-v2 C3):
 * canonicalize (determinism + dev-chrome stripping), the PNG codec
 * round-trip, and the diff/cluster machinery. No browser, no network.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { deflateSync } from "node:zlib";
import { expect, test } from "@playwright/test";
import { canonicalize, collectStylesheetLinks, linkHref, type CanonicalizeInput } from "./canonicalize";
import { clusterBoxes, diffPixels } from "./diff";
import { decodePng, encodePng } from "./png";

const MOCKUP_PATH = path.resolve(__dirname, "../../docs/archive/design-sync/Landing - Seichijunrei.html");
const FONTS_CSS_PATH = path.resolve(__dirname, "../../apps/web/src/styles/fonts.css");

function mockupInput(mode: "day" | "night" = "day"): CanonicalizeInput {
  const html = readFileSync(MOCKUP_PATH, "utf8");
  const mockupDir = path.dirname(MOCKUP_PATH);
  const stylesheets = collectStylesheetLinks(html)
    .map((link) => linkHref(link))
    .filter((href) => !href.startsWith("http"))
    .map((href) => ({ href, css: readFileSync(path.join(mockupDir, href), "utf8") }));
  return { html, appFontsCss: readFileSync(FONTS_CSS_PATH, "utf8"), stylesheets, mode };
}

/** 8-bit, non-interlaced PNG with the given raw (filter+bytes) scanlines. */
function buildPng(colorType: number, width: number, height: number, raw: Buffer): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = colorType;
  const idat = deflateSync(raw);
  const lengthOf = (size: number): Buffer => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(size, 0);
    return length;
  };
  // Reader skips CRCs, but the chunk layout must include them (4 bytes).
  const crc = Buffer.alloc(4);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.concat([lengthOf(13), Buffer.from("IHDR"), ihdr, crc]),
    Buffer.concat([lengthOf(idat.length), Buffer.from("IDAT"), idat, crc]),
  ]);
}

test.describe("canonicalize", () => {
  test("is deterministic: same input → byte-identical output", () => {
    const input = mockupInput();
    expect(canonicalize(input).html).toBe(canonicalize(input).html);
  });

  test("strips dev chrome and network fonts from the landing mockup", () => {
    const out = canonicalize(mockupInput()).html;
    expect(out).not.toContain("fonts.googleapis.com");
    expect(out).not.toContain("fonts.gstatic.com");
    expect(out).not.toContain("cdn.jsdelivr.net");
    expect(out).not.toContain("#modeTg");
    expect(out).not.toMatch(/<script/i);
  });

  test("injects the app's self-hosted @font-face CSS verbatim", () => {
    const out = canonicalize(mockupInput()).html;
    expect(out).toContain('data-visual-fonts="app"');
    expect(out).toContain('url("/fonts/nunito-latin-500-normal.woff2")');
    expect(out).toContain('font-family: "Zen Maru Gothic"');
  });

  test("inlines the mockup stylesheet and kills animations", () => {
    const out = canonicalize(mockupInput()).html;
    expect(out).toContain('data-visual-inline="assets/index.css"');
    expect(out).toContain('data-visual-determinism="animations"');
    expect(out).toContain("animation:none!important");
  });

  test("bakes night mode into <body>", () => {
    const out = canonicalize(mockupInput("night")).html;
    expect(out).toContain('<body class="night">');
    expect(canonicalize(mockupInput("day")).html).toContain("<body>");
  });

  test("collects the mockup's asset references", () => {
    const out = canonicalize(mockupInput());
    expect(out.assetRefs).toContain("assets/fox/fox-lean.svg");
    expect(out.assetRefs).toContain("assets/torii.svg");
  });
});

test.describe("png codec", () => {
  test("encode→decode round-trips arbitrary RGBA pixels", () => {
    const width = 37;
    const height = 13;
    const rgba = new Uint8Array(width * height * 4);
    for (let i = 0; i < rgba.length; i++) rgba[i] = (i * 7 + 13) % 256;
    const decoded = decodePng(encodePng({ width, height, rgba }));
    expect(decoded.width).toBe(width);
    expect(decoded.height).toBe(height);
    expect(Buffer.from(decoded.rgba).equals(Buffer.from(rgba))).toBe(true);
  });

  test("decodes a 1x1 PNG with each scanline filter", () => {
    const rgba = new Uint8Array([10, 20, 30, 255]);
    for (let filter = 0; filter <= 4; filter++) {
      const raw = Buffer.concat([Buffer.from([filter]), Buffer.from(rgba)]);
      const bytes = buildPng(6, 1, 1, raw);
      expect(Buffer.from(decodePng(bytes).rgba).equals(rgba)).toBe(true);
    }
  });

  test("decodes RGB (colorType 2) PNGs with previous-row filters", () => {
    // Row 0: filter 0. Row 1: filter 2 (Up). Row 2: filter 3 (Average) —
    // both must reconstruct from the RGB-stride previous row, not an RGBA stride.
    const raw = Buffer.concat([
      Buffer.from([0, 10, 20, 30, 40, 50, 60]),
      Buffer.from([2, 60, 60, 60, 60, 60, 60]),
      Buffer.from([3, 95, 100, 105, 45, 45, 45]),
    ]);
    const decoded = decodePng(buildPng(2, 2, 3, raw));
    const expected = Buffer.from([
      10, 20, 30, 255, 40, 50, 60, 255, //
      70, 80, 90, 255, 100, 110, 120, 255, //
      130, 140, 150, 255, 160, 170, 180, 255,
    ]);
    expect(Buffer.from(decoded.rgba).equals(expected)).toBe(true);
  });

  test("rejects corrupt input", () => {
    expect(() => decodePng(new Uint8Array([1, 2, 3]))).toThrow();
  });
});

test.describe("diff", () => {
  test("identical buffers diff to ratio 0 and empty clusters", () => {
    const rgba = new Uint8Array(8 * 6 * 4).fill(128);
    const { ratio, diff } = diffPixels(rgba, rgba);
    expect(ratio).toBe(0);
    expect(clusterBoxes(diff, 8, 6)).toEqual([]);
  });

  test("a single changed pixel is caught at 1/(w*h)", () => {
    const a = new Uint8Array(8 * 6 * 4).fill(128);
    const b = new Uint8Array(a);
    b[4] = 0;
    const { ratio, diff } = diffPixels(a, b);
    expect(ratio).toBeCloseTo(1 / (8 * 6), 10);
    const clusters = clusterBoxes(diff, 8, 6, 1);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]).toMatchObject({ x: 1, y: 0, width: 1, height: 1, area: 1 });
  });

  test("adjacent diffs merge into one cluster; distant ones stay separate", () => {
    const a = new Uint8Array(10 * 10 * 4).fill(100);
    const b = new Uint8Array(a);
    for (const [x, y] of [[2, 2], [3, 2], [2, 3], [7, 7]] as const) {
      const i = (y * 10 + x) * 4;
      b[i] = 0;
    }
    const { diff } = diffPixels(a, b);
    const clusters = clusterBoxes(diff, 10, 10, 1);
    expect(clusters).toHaveLength(2);
    expect(clusters[0]).toMatchObject({ x: 2, y: 2, width: 2, height: 2, area: 3 });
    expect(clusters[1]).toMatchObject({ x: 7, y: 7, width: 1, height: 1, area: 1 });
  });

  test("minArea filters noise clusters", () => {
    const a = new Uint8Array(10 * 10 * 4).fill(100);
    const b = new Uint8Array(a);
    for (const [x, y] of [[2, 2], [3, 2], [2, 3], [7, 7]] as const) {
      const i = (y * 10 + x) * 4;
      b[i] = 0;
    }
    const { diff } = diffPixels(a, b);
    expect(clusterBoxes(diff, 10, 10, 3)).toHaveLength(1);
  });
});
