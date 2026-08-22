import { describe, expect, it } from "vitest";
import animalCss from "animal-island-ui-tailwind/dist/index.css?raw";
import globalsCss from "../../src/styles/globals.css?raw";
import {
  alignmentMismatches,
  contrastRatio,
  parseBlockTokens,
  parseTokens,
  relativeLuminance,
  tokenValue,
  type TokenMap,
} from "./stylesheet-probe";

const semanticTokens = parseTokens(globalsCss);
const animalTokens = parseTokens(animalCss);
const nightTokens = parseBlockTokens(globalsCss, '[data-theme="night"]');

const alignment: TokenMap = {
  "--color-primary": "--animal-primary-color",
  "--color-primary-hover": "--animal-primary-color-hover",
  "--color-primary-active": "--animal-primary-color-active",
  "--color-primary-soft": "--animal-primary-color-bg",
  "--color-fg": "--animal-text-color-body",
  "--color-bg": "--animal-bg-color-secondary",
  "--color-paper": "--animal-bg-color",
  "--color-card": "--animal-bg-color-content",
  "--color-border": "--animal-border-color",
  "--color-border-soft": "--animal-border-color-light",
  "--color-focus": "--animal-focus-yellow",
  "--color-success-fg": "--animal-success-color",
  "--color-warning-fg": "--animal-warning-color",
  "--color-error-fg": "--animal-error-color",
};

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

describe("cream base stack (動森 spec)", () => {
  it.each([
    ["--color-bg", "#f0e8d8"],
    ["--color-paper", "#f8f8f0"],
    ["--color-card", "#f7f3df"],
    ["--color-muted", "#e8ddc8"],
  ])("pins %s to %s", (token, expected) => {
    expect(tokenValue(semanticTokens, token)).toBe(expected);
  });

  it("floats paper and card above the page floor, never below it", () => {
    const floor = relativeLuminance(tokenValue(semanticTokens, "--color-bg"));
    expect(relativeLuminance(tokenValue(semanticTokens, "--color-card"))).toBeGreaterThan(floor);
    expect(relativeLuminance(tokenValue(semanticTokens, "--color-paper"))).toBeGreaterThan(floor);
  });

  it("keeps the same floor-below-surfaces order at night", () => {
    const floor = relativeLuminance(tokenValue(nightTokens, "--color-bg"));
    expect(relativeLuminance(tokenValue(nightTokens, "--color-card"))).toBeGreaterThan(floor);
    expect(relativeLuminance(tokenValue(nightTokens, "--color-paper"))).toBeGreaterThan(floor);
  });

  it("derives the press shadow from the 3d shadow token", () => {
    expect(tokenValue(semanticTokens, "--shadow-press")).toContain("var(--shadow-3d)");
  });
});

describe("night theme coverage", () => {
  it.each([
    "--color-primary-soft",
    "--color-explore-bg",
    "--color-explore-fg",
    "--color-walk-bg",
    "--color-walk-fg",
    "--color-paper",
    "--color-border-soft",
    "--shadow-3d",
  ])("overrides %s at night", (token) => {
    expect(tokenValue(nightTokens, token)).not.toBe(tokenValue(semanticTokens, token));
  });

  it("keeps explore text readable on the night explore background", () => {
    const foreground = tokenValue(nightTokens, "--color-explore-fg");
    const background = tokenValue(nightTokens, "--color-explore-bg");
    expect(contrastRatio(foreground, background)).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps walk text readable on the night walk background", () => {
    const foreground = tokenValue(nightTokens, "--color-walk-fg");
    const background = tokenValue(nightTokens, "--color-walk-bg");
    expect(contrastRatio(foreground, background)).toBeGreaterThanOrEqual(4.5);
  });
});

describe("page floor glow (design-sync body)", () => {
  const bodyBackground = (css: string, selector: string): string => {
    const escaped = selector.replaceAll(/[.*+?^${}()|[\]\\]/gu, String.raw`\$&`);
    const rule = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, "u").exec(css)?.[1] ?? "";
    return /background:([^;]+)/u.exec(rule)?.[1] ?? "";
  };

  it("layers two overflowing top glows over the page floor", () => {
    const background = bodyBackground(globalsCss, "body");
    expect([...background.matchAll(/radial-gradient/gu)]).toHaveLength(2);
    expect(background.trimEnd().endsWith("var(--color-bg)")).toBe(true);
  });

  it("swaps the glows for the night pair instead of leaving the day tints", () => {
    const background = bodyBackground(globalsCss, '[data-theme="night"] body');
    expect([...background.matchAll(/radial-gradient/gu)]).toHaveLength(2);
    expect(background).not.toContain("#e7f1fb");
    expect(background.trimEnd().endsWith("var(--color-bg)")).toBe(true);
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