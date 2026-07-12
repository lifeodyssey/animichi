/**
 * @vitest-environment jsdom
 */

import { describe, expect, it } from "vitest";
import animalCss from "animal-island-ui-tailwind/dist/index.css?raw";
import fontsCss from "../../src/styles/fonts.css?raw";
import globalsCss from "../../src/styles/globals.css?raw";
import {
  alignmentMismatches,
  contrastRatio,
  parseTokens,
  tokenValue,
  type TokenMap,
} from "./_token-helpers";

const semanticTokens = parseTokens(globalsCss);
const animalTokens = parseTokens(animalCss);

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
  it("vendors Zen Maru Gothic font faces", () => {
    expect(fontsCss).toMatch(
      /@font-face\s*\{[^}]*font-family:\s*["']?Zen Maru Gothic["']?[^}]*\}/su,
    );
  });

  it("resolves the Japanese body stack to Zen Maru Gothic", () => {
    const paragraph = document.createElement("p");
    paragraph.lang = "ja";
    paragraph.textContent = "日本語のテスト";
    paragraph.style.fontFamily = tokenValue(semanticTokens, "--app-font-body");
    document.body.append(paragraph);
    expect(getComputedStyle(paragraph).fontFamily).toContain("Zen Maru Gothic");
    paragraph.remove();
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
