import { describe, expect, it } from "vitest";
import animeCss from "../../../src/styles/anime.css?raw";
import globalsCss from "../../../src/styles/globals.css?raw";
import { contrastRatio, parseBlockTokens, ruleDeclaration, tokenValue } from "../_token-helpers";
import type { TokenMap } from "../_token-helpers";

/**
 * WCAG 1.4.3 AA (4.5:1) for every text pair the anime skin actually paints, in
 * both themes. Each pair is read back out of the stylesheet, so a recoloured
 * rule fails here rather than shipping. Mirrors route-detail-contrast.test.ts.
 */
const DAY: TokenMap = parseBlockTokens(globalsCss, ":root");
const NIGHT: TokenMap = parseBlockTokens(globalsCss, '[data-theme="night"]');

const AA = 4.5;

/** `color` / `background`, never `border-color` — the helper interpolates raw. */
const TEXT = String.raw`(?<![-\w])color`;
const GROUND = String.raw`(?<![-\w])background`;

function palette(night: boolean): TokenMap {
  return night ? { ...DAY, ...NIGHT } : DAY;
}

/** Follow a declared value through its `var(--…)` chain down to a literal colour. */
function resolve(value: string, night: boolean): string {
  const target = /var\((--[\w-]+)\)/u.exec(value)?.[1];
  if (target === undefined) return value;
  return resolve(tokenValue(palette(night), target), night);
}

/** The colour a rule really paints, as the browser would compute it. */
function paint(selector: string, property: string, night: boolean): string {
  const declared = ruleDeclaration(animeCss, selector, property);
  if (declared === null) throw new Error(`${selector} declares no ${property}`);
  return resolve(declared, night);
}

function readability(selector: string, ground: string, night: boolean): number {
  return contrastRatio(paint(selector, TEXT, night), paint(ground, GROUND, night));
}

describe("every surface the skin paints has a night override", () => {
  it.each(["--color-paper", "--color-card", "--color-muted", "--color-border-soft"])(
    "%s flips for night, so no day cream is left on the dark floor", (name: string) => {
      expect(NIGHT[name]).toBeDefined();
    });

  it("repaints the card ground itself, not just the text on it", () => {
    expect(paint(".anime-card", GROUND, true)).not.toBe(paint(".anime-card", GROUND, false));
  });
});

describe.each([
  ["day", false],
  ["night", true],
])("text contrast on the %s surfaces", (_label, night: boolean) => {
  it("hero title and subtitle over the page floor", () => {
    expect(contrastRatio(paint(".anime-hero__title", TEXT, night), resolve("var(--color-bg)", night)))
      .toBeGreaterThanOrEqual(AA);
    expect(contrastRatio(paint(".anime-hero__subtitle", TEXT, night), resolve("var(--color-bg)", night)))
      .toBeGreaterThanOrEqual(AA);
  });

  it("section heading over the page floor", () => {
    expect(contrastRatio(paint(".anime-sechead__label", TEXT, night), resolve("var(--color-bg)", night)))
      .toBeGreaterThanOrEqual(AA);
  });

  it("fact label and sentence on the nested panel cream", () => {
    expect(readability(".anime-fact__label", ".anime-fact", night)).toBeGreaterThanOrEqual(AA);
    expect(readability(".anime-fact__value", ".anime-fact", night)).toBeGreaterThanOrEqual(AA);
  });

  it("scene name, meta and empty prose on the card paper", () => {
    for (const selector of [".anime-scene__name", ".anime-scene__meta", ".anime-empty__body"]) {
      expect(readability(selector, ".anime-card", night)).toBeGreaterThanOrEqual(AA);
    }
  });

  it("area row name on the card paper", () => {
    expect(readability(".anime-area__name", ".anime-card", night)).toBeGreaterThanOrEqual(AA);
  });

  it("every pill tone reads on its own ground", () => {
    for (const tone of ["teal", "gold", "plain"]) {
      const pill = `.anime-pill--${tone}`;
      expect(readability(pill, pill, night)).toBeGreaterThanOrEqual(AA);
    }
  });

  it("press-button label on its own cream ground", () => {
    expect(readability(".anime-press", ".anime-press", night)).toBeGreaterThanOrEqual(AA);
  });
});

describe("the known solid-gold trap stays shut", () => {
  it("never pairs --color-gold-fg with the solid gold, which fails at night", () => {
    expect(paint(".anime-pill--gold", GROUND, false)).toBe(resolve("var(--color-gold-soft)", false));
    expect(contrastRatio(tokenValue(DAY, "--color-gold-fg"), tokenValue(DAY, "--color-gold")))
      .toBeLessThan(AA);
  });
});

/**
 * WCAG 1.4.11 on the one operable control this page has. Batch 4's finding
 * (chat-visual-restore/task.md §6) applies unchanged: by day the 3D drop
 * shadow puts a 1.77:1 halo on the page floor, so the button is findable
 * without leaning on its border; at night the same shadow falls to 1.12:1, the
 * halo disappears, and the border becomes the ONLY boundary — which is why
 * night lifts --color-border and why the 3:1 floor is asserted there.
 */
describe("WCAG 1.4.11 non-text contrast for the operable control", () => {
  const floor = (night: boolean): string => resolve("var(--color-bg)", night);
  const halo = (night: boolean): number =>
    contrastRatio(resolve("var(--shadow-3d)", night), floor(night));

  it("keeps the border as the night boundary, above the 3:1 floor", () => {
    const border = resolve("var(--color-border)", true);
    expect(contrastRatio(border, paint(".anime-press", GROUND, true))).toBeGreaterThanOrEqual(3);
  });

  it("hangs the day boundary on the 3D halo the night ground cannot carry", () => {
    expect(ruleDeclaration(animeCss, ".anime-press", "box-shadow")).toContain("var(--shadow-3d)");
    expect(halo(false)).toBeGreaterThan(halo(true));
  });
});
