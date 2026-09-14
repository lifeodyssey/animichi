import { describe, expect, it } from "vitest";
import globalsCss from "../../src/styles/globals.css?raw";
import type { TokenMap } from "./stylesheet-probe";
import { contrastRatio, parseBlockTokens, parseTokens, tokenValue } from "./stylesheet-probe";

const day = parseTokens(globalsCss);
const night = parseBlockTokens(globalsCss, '[data-theme="night"]');

function contrastIn(palette: TokenMap, ink: string, ground: string): number {
  return contrastRatio(tokenValue(palette, ink), tokenValue(palette, ground));
}

const nightPalette: TokenMap = { ...day, ...night };

describe("chat inline notice tones meet WCAG AA (>= 4.5:1)", () => {
  it("keeps the retry tone readable in both palettes", () => {
    expect(contrastIn(day, "--color-fg", "--color-primary-soft")).toBeGreaterThanOrEqual(4.5);
    expect(contrastIn(nightPalette, "--color-fg", "--color-primary-soft")).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps the auth tone readable in both palettes", () => {
    expect(contrastIn(day, "--color-fg", "--color-gold-soft")).toBeGreaterThanOrEqual(4.5);
    expect(contrastIn(nightPalette, "--color-fg", "--color-gold-soft")).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps the error tone readable on its tinted ground (banner and tool step)", () => {
    expect(contrastIn(day, "--color-error-strong", "--color-error-bg")).toBeGreaterThanOrEqual(4.5);
  });
});
