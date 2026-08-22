import { describe, expect, it } from "vitest";
import globalsCss from "../../../src/styles/globals.css?raw";
import routeCss from "../../../src/styles/route-detail.css?raw";
import {
  AA_CONTRAST,
  GROUND_COLOR,
  SkinContrast,
  contrastRatio,
  parseBlockTokens,
  tokenValue,
} from "../stylesheet-probe";
import type { Theme, TokenMap } from "../stylesheet-probe";

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

const skin = new SkinContrast({ day: { ...DAY, ...LOCAL }, night: NIGHT, sheet: routeCss });

describe("every surface the skin paints has a night override", () => {
  it.each(["--color-paper", "--color-card", "--color-muted", "--color-border-soft"])(
    "%s flips for night, so no day cream is left on the dark floor", (name: string) => {
      expect(NIGHT[name]).toBeDefined();
    });

  it("repaints the card ground itself, not just the text on it", () => {
    expect(skin.paint(".route-card", GROUND_COLOR, "night"))
      .not.toBe(skin.paint(".route-card", GROUND_COLOR, "day"));
  });
});

describe.each(["day", "night"] as const)("text contrast on the %s surfaces", (theme: Theme) => {
  it("hero title and timetable copy on the card paper", () => {
    expect(skin.readability(".route-hero__title", ".route-card", theme)).toBeGreaterThanOrEqual(AA_CONTRAST);
    expect(skin.readability(".route-panel__body", ".route-card", theme)).toBeGreaterThanOrEqual(AA_CONTRAST);
    expect(skin.readability(".route-panel__title", ".route-card", theme)).toBeGreaterThanOrEqual(AA_CONTRAST);
  });

  it("map stage placeholder on the map ground", () => {
    expect(skin.readability(".route-map__stage", ".route-map__stage", theme)).toBeGreaterThanOrEqual(AA_CONTRAST);
  });

  it("map foot hint on the panel and press label on its own ground", () => {
    expect(skin.readability(".route-map__hint", ".route-map__bar", theme)).toBeGreaterThanOrEqual(AA_CONTRAST);
    expect(skin.readability(".route-press", ".route-press", theme)).toBeGreaterThanOrEqual(AA_CONTRAST);
  });

  it("today gold bar label on its soft gold tint", () => {
    expect(skin.readability(".route-goldbar", ".route-goldbar", theme)).toBeGreaterThanOrEqual(AA_CONTRAST);
  });

  it("gold pill ink on the solid gold ground", () => {
    expect(skin.readability(".route-pill--gold", ".route-pill--gold", theme)).toBeGreaterThanOrEqual(AA_CONTRAST);
  });

  it.each(["visited", "current", "unvisited"])("the %s pin glyph reads on its own frame", (state: string) => {
    const pin = `.route-pin[data-state="${state}"]`;
    expect(skin.readability(pin, pin, theme)).toBeGreaterThanOrEqual(AA_CONTRAST);
  });
});

describe("the solid gold family is theme-invariant", () => {
  it("keeps one gold ground in both themes, so its ink must not flip", () => {
    expect(NIGHT["--color-gold"]).toBeUndefined();
    expect(tokenValue(LOCAL, "--route-gold-ink")).not.toBe(tokenValue(DAY, "--color-gold-fg"));
    expect(contrastRatio(tokenValue(DAY, "--color-gold-fg"), tokenValue(DAY, "--color-gold"))).toBeLessThan(AA_CONTRAST);
  });
});
