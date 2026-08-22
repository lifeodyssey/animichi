import { describe, expect, it } from "vitest";
import globalsCss from "../../src/styles/globals.css?raw";
import { contrastRatio, parseBlockTokens, parseTokens, tokenValue } from "./stylesheet-probe";

const semanticTokens = parseTokens(globalsCss);
const nightTokens = parseBlockTokens(globalsCss, '[data-theme="night"]');

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

  it("keeps body text readable on the darker page floor", () => {
    const foreground = tokenValue(semanticTokens, "--color-fg");
    expect(contrastRatio(foreground, tokenValue(semanticTokens, "--color-bg"))).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(foreground, tokenValue(semanticTokens, "--color-paper"))).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps night text readable on the night paper surface", () => {
    const foreground = tokenValue(nightTokens, "--color-fg");
    expect(contrastRatio(foreground, tokenValue(nightTokens, "--color-paper"))).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(tokenValue(nightTokens, "--color-muted-fg"), tokenValue(nightTokens, "--color-paper"))).toBeGreaterThanOrEqual(4.5);
  });

  it("gives the bright teal ground an ink that clears AA where white cannot", () => {
    const teal = tokenValue(semanticTokens, "--color-primary");
    expect(contrastRatio(tokenValue(semanticTokens, "--color-primary-fg"), teal)).toBeLessThan(4.5);
    expect(contrastRatio(tokenValue(semanticTokens, "--color-primary-ink"), teal)).toBeGreaterThanOrEqual(4.5);
  });

  it("reuses that ink at night, where the teal ground is unchanged", () => {
    expect(nightTokens["--color-primary-ink"]).toBeUndefined();
    const ink = tokenValue(semanticTokens, "--color-primary-ink");
    expect(contrastRatio(ink, tokenValue(semanticTokens, "--color-primary"))).toBeGreaterThanOrEqual(4.5);
  });
});