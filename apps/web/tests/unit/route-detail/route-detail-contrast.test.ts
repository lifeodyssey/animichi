import { describe, expect, it } from "vitest";
import globalsCss from "../../../src/styles/globals.css?raw";
import routeCss from "../../../src/styles/route-detail.css?raw";
import { contrastRatio, parseBlockTokens, ruleDeclaration, tokenValue } from "../stylesheet-probe";
import type { TokenMap } from "../stylesheet-probe";

/**
 * WCAG 1.4.3 AA (4.5:1) for every text pair the route-detail skin actually
 * paints, in both themes — each pair is read back out of the stylesheet, so a
 * recoloured rule fails here rather than shipping. The skin paints only
 * semantic tokens, so "night works" reduces to two facts: every surface token
 * it uses is overridden for night, and every pair still clears AA there.
 */
const DAY: TokenMap = parseBlockTokens(globalsCss, ":root");
const NIGHT: TokenMap = parseBlockTokens(globalsCss, '[data-theme="night"]');
const LOCAL: TokenMap = parseBlockTokens(routeCss, ".route-detail");

const AA = 4.5;

/** `color` / `background`, never `border-color` — the helper interpolates raw. */
const TEXT = String.raw`(?<![-\w])color`;
const GROUND = String.raw`(?<![-\w])background`;

function palette(night: boolean): TokenMap {
  return night ? { ...DAY, ...LOCAL, ...NIGHT } : { ...DAY, ...LOCAL };
}

/** Follow a declared value through its `var(--…)` chain down to a literal colour. */
function resolve(value: string, night: boolean): string {
  const target = /var\((--[\w-]+)\)/u.exec(value)?.[1];
  if (target === undefined) return value;
  return resolve(tokenValue(palette(night), target), night);
}

/** The colour a rule really paints, as the browser would compute it. */
function paint(selector: string, property: string, night: boolean): string {
  const declared = ruleDeclaration(routeCss, selector, property);
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
    expect(paint(".route-card", GROUND, true)).not.toBe(paint(".route-card", GROUND, false));
  });
});

describe.each([
  ["day", false],
  ["night", true],
])("text contrast on the %s surfaces", (_label, night: boolean) => {
  it("hero title and timetable copy on the card paper", () => {
    expect(readability(".route-hero__title", ".route-card", night)).toBeGreaterThanOrEqual(AA);
    expect(readability(".route-panel__body", ".route-card", night)).toBeGreaterThanOrEqual(AA);
    expect(readability(".route-panel__title", ".route-card", night)).toBeGreaterThanOrEqual(AA);
  });

  it("map stage placeholder on the map ground", () => {
    expect(readability(".route-map__stage", ".route-map__stage", night)).toBeGreaterThanOrEqual(AA);
  });

  it("map foot hint on the panel and press label on its own ground", () => {
    expect(readability(".route-map__hint", ".route-map__bar", night)).toBeGreaterThanOrEqual(AA);
    expect(readability(".route-press", ".route-press", night)).toBeGreaterThanOrEqual(AA);
  });

  it("today gold bar label on its soft gold tint", () => {
    expect(readability(".route-goldbar", ".route-goldbar", night)).toBeGreaterThanOrEqual(AA);
  });

  it("gold pill ink on the solid gold ground", () => {
    expect(readability(".route-pill--gold", ".route-pill--gold", night)).toBeGreaterThanOrEqual(AA);
  });

  it("every pin glyph on its own frame", () => {
    for (const state of ["visited", "current", "unvisited"]) {
      const pin = `.route-pin[data-state="${state}"]`;
      expect(readability(pin, pin, night)).toBeGreaterThanOrEqual(AA);
    }
  });
});

describe("the solid gold family is theme-invariant", () => {
  it("keeps one gold ground in both themes, so its ink must not flip", () => {
    expect(NIGHT["--color-gold"]).toBeUndefined();
    expect(tokenValue(LOCAL, "--route-gold-ink")).not.toBe(tokenValue(DAY, "--color-gold-fg"));
    expect(contrastRatio(tokenValue(DAY, "--color-gold-fg"), tokenValue(DAY, "--color-gold"))).toBeLessThan(AA);
  });
});
