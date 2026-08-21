import { describe, expect, it } from "vitest";
import animalCss from "animal-island-ui-tailwind/dist/index.css?raw";
import fontsCss from "../../src/styles/fonts.css?raw";
import globalsCss from "../../src/styles/globals.css?raw";
import {
  alignmentMismatches,
  contrastRatio,
  parseBlockTokens,
  parseFontFaces,
  parseTokens,
  relativeLuminance,
  srcForCodepoint,
  tokenValue,
  type TokenMap,
} from "./_token-helpers";

const semanticTokens = parseTokens(globalsCss);
const animalTokens = parseTokens(animalCss);
const nightTokens = parseBlockTokens(globalsCss, '[data-theme="night"]');
const fontFaces = parseFontFaces(fontsCss);

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
