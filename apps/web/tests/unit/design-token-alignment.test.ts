import { describe, expect, it } from "vitest";
import animalCss from "animal-island-ui-tailwind/dist/index.css?raw";
import fontsCss from "../../src/styles/fonts.css?raw";
import globalsCss from "../../src/styles/globals.css?raw";
import {
  alignmentMismatches,
  contrastRatio,
  parseFontFaces,
  parseTokens,
  srcForCodepoint,
  tokenValue,
  type TokenMap,
} from "./_token-helpers";

const semanticTokens = parseTokens(globalsCss);
const animalTokens = parseTokens(animalCss);
const fontFaces = parseFontFaces(fontsCss);

const alignment: TokenMap = {
  "--color-primary": "--animal-primary-color",
  "--color-primary-hover": "--animal-primary-color-hover",
  "--color-primary-active": "--animal-primary-color-active",
  "--color-primary-soft": "--animal-primary-color-bg",
  "--color-fg": "--animal-text-color-body",
  "--color-card": "--animal-bg-color",
  "--color-muted": "--animal-bg-color-secondary",
  "--color-border": "--animal-border-color",
  "--color-focus": "--animal-focus-yellow",
  "--color-success-fg": "--animal-success-color",
  "--color-warning-fg": "--animal-warning-color",
  "--color-error-fg": "--animal-error-color",
};

describe("design token font foundation", () => {
  it("vendors every required Zen Maru Gothic subset", () => {
    const zenFaces = fontFaces.filter(({ family }) => family === "Zen Maru Gothic");
    expect(zenFaces.map(({ weight }) => weight)).toEqual([500, 500, 700, 700]);
    expect(zenFaces.map(({ src }) => src)).toEqual([
      'url("/fonts/zen-maru-gothic-japanese-500-normal.woff2") format("woff2")',
      'url("/fonts/zen-maru-gothic-latin-500-normal.woff2") format("woff2")',
      'url("/fonts/zen-maru-gothic-japanese-700-normal.woff2") format("woff2")',
      'url("/fonts/zen-maru-gothic-latin-700-normal.woff2") format("woff2")',
    ]);
    expect(zenFaces.map(({ unicodeRange }) => unicodeRange === null)).toEqual([
      true, false, true, false,
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

describe("semantic token backfills", () => {
  it.each([
    "--color-explore-bg",
    "--color-explore-fg",
    "--color-walk-bg",
    "--color-walk-fg",
    "--color-map-pin-teal",
    "--color-map-pin-green",
    "--color-map-pin-orange",
    "--color-map-pin-brand",
  ])("defines %s", (token) => {
    expect(tokenValue(semanticTokens, token)).not.toBe("");
  });
});

describe("package primitive alignment", () => {
  it("matches every aligned installed primitive", () => {
    expect(alignmentMismatches(semanticTokens, animalTokens, alignment)).toEqual([]);
  });

  it("reports primitive drift after a package change", () => {
    const drifted = { ...animalTokens, "--animal-primary-color": "#ff0000" };
    const mismatches = alignmentMismatches(semanticTokens, drifted, alignment);
    expect(mismatches.map(({ semantic }) => semantic)).toContain("--color-primary");
  });
});

describe("accessible semantic colors", () => {
  it("keeps muted text readable on the page background", () => {
    const foreground = tokenValue(semanticTokens, "--color-muted-fg");
    const background = tokenValue(semanticTokens, "--color-bg");
    expect(contrastRatio(foreground, background)).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps white text readable on strong teal", () => {
    const foreground = tokenValue(semanticTokens, "--color-primary-fg");
    const background = tokenValue(semanticTokens, "--color-primary-strong");
    expect(contrastRatio(foreground, background)).toBeGreaterThanOrEqual(4.5);
  });
});
