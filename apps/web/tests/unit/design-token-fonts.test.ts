import { describe, expect, it } from "vitest";
import fontsCss from "../../src/styles/fonts.css?raw";
import globalsCss from "../../src/styles/globals.css?raw";
import { parseFontFaces, parseTokens, srcForCodepoint, tokenValue } from "./stylesheet-probe";

const semanticTokens = parseTokens(globalsCss);
const fontFaces = parseFontFaces(fontsCss);

describe("design token font foundation", () => {
  it("vendors every required Zen Maru Gothic subset", () => {
    const zenFaces = fontFaces.filter(({ family }) => family === "Zen Maru Gothic");
    expect(zenFaces.map(({ weight }) => weight)).toEqual([500, 500, 700, 700, 900, 900]);
    expect(zenFaces.map(({ src }) => src)).toEqual([
      'url("/fonts/zen-maru-gothic-japanese-500-normal.woff2") format("woff2")',
      'url("/fonts/zen-maru-gothic-latin-500-normal.woff2") format("woff2")',
      'url("/fonts/zen-maru-gothic-japanese-700-normal.woff2") format("woff2")',
      'url("/fonts/zen-maru-gothic-latin-700-normal.woff2") format("woff2")',
      'url("/fonts/zen-maru-gothic-japanese-900-normal.woff2") format("woff2")',
      'url("/fonts/zen-maru-gothic-latin-900-normal.woff2") format("woff2")',
    ]);
    expect(zenFaces.map(({ unicodeRange }) => unicodeRange === null)).toEqual([
      true, false, true, false, true, false,
    ]);
  });

  it("resolves Japanese and Latin codepoints to the correct Zen Maru subset", () => {
    expect(tokenValue(semanticTokens, "--app-font-body")).toContain('"Zen Maru Gothic"');
    expect(srcForCodepoint(fontFaces, "Zen Maru Gothic", 500, 0x65e5)).toMatch(/japanese-500/u);
    expect(srcForCodepoint(fontFaces, "Zen Maru Gothic", 500, 0x0041)).toMatch(/latin-500/u);
    expect(srcForCodepoint(fontFaces, "Zen Maru Gothic", 700, 0x65e5)).toMatch(/japanese-700/u);
    expect(srcForCodepoint(fontFaces, "Zen Maru Gothic", 700, 0x0041)).toMatch(/latin-700/u);
  });
});