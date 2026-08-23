import { describe, expect, it } from "vitest";
import animeCss from "../../../src/styles/anime.css?raw";
import cardPlaneCss from "../../../src/styles/card-plane.css?raw";
import pressCss from "../../../src/styles/press-3d.css?raw";
import globalsCss from "../../../src/styles/globals.css?raw";
import {
  AA_CONTRAST,
  GROUND_COLOR,
  SkinContrast,
  TEXT_COLOR,
  contrastRatio,
  parseBlockTokens,
  sharedRuleDeclaration,
  tokenValue,
} from "../stylesheet-probe";
import type { Theme, TokenMap } from "../stylesheet-probe";

/**
 * WCAG 1.4.3 AA (4.5:1) for every text pair the anime skin actually paints, in
 * both themes. Each pair is read back out of the stylesheet, so a recoloured
 * rule fails here rather than shipping. Mirrors route-detail-contrast.test.ts.
 */
const DAY: TokenMap = parseBlockTokens(globalsCss, ":root");
const NIGHT: TokenMap = parseBlockTokens(globalsCss, '[data-theme="night"]');

/* The card plane and the press depth are declared once, in their own sheets;
 * the browser reads them together with this skin, and so does this suite. The
 * shared sheets come FIRST, because they are layered and therefore lose to the
 * skin's own rules — `sharedRuleDeclaration` takes the last word. */
const skin = new SkinContrast({
  day: DAY,
  night: NIGHT,
  sheet: `${cardPlaneCss}\n${pressCss}\n${animeCss}`,
  declarationOf: sharedRuleDeclaration,
});

describe("every surface the skin paints has a night override", () => {
  it.each(["--color-paper", "--color-card", "--color-muted", "--color-border-soft"])(
    "%s flips for night, so no day cream is left on the dark floor", (name: string) => {
      expect(NIGHT[name]).toBeDefined();
    });

  it("repaints the card ground itself, not just the text on it", () => {
    expect(skin.paint(".anime-card", GROUND_COLOR, "night"))
      .not.toBe(skin.paint(".anime-card", GROUND_COLOR, "day"));
  });
});

describe.each(["day", "night"] as const)("text contrast on the %s surfaces", (theme: Theme) => {
  it("hero title and subtitle over the page floor", () => {
    expect(contrastRatio(skin.paint(".anime-hero__title", TEXT_COLOR, theme), skin.resolve("var(--color-bg)", theme)))
      .toBeGreaterThanOrEqual(AA_CONTRAST);
    expect(contrastRatio(skin.paint(".anime-hero__subtitle", TEXT_COLOR, theme), skin.resolve("var(--color-bg)", theme)))
      .toBeGreaterThanOrEqual(AA_CONTRAST);
  });

  it("section heading over the page floor", () => {
    expect(contrastRatio(skin.paint(".anime-sechead__label", TEXT_COLOR, theme), skin.resolve("var(--color-bg)", theme)))
      .toBeGreaterThanOrEqual(AA_CONTRAST);
  });

  it("fact label and sentence on the nested panel cream", () => {
    expect(skin.readability(".anime-fact__label", ".anime-fact", theme)).toBeGreaterThanOrEqual(AA_CONTRAST);
    expect(skin.readability(".anime-fact__value", ".anime-fact", theme)).toBeGreaterThanOrEqual(AA_CONTRAST);
  });

  it.each([".anime-scene__name", ".anime-scene__meta", ".anime-empty__body"])(
    "%s reads on the card paper", (selector: string) => {
      expect(skin.readability(selector, ".anime-card", theme)).toBeGreaterThanOrEqual(AA_CONTRAST);
    });

  it("area row name on the card paper", () => {
    expect(skin.readability(".anime-area__name", ".anime-card", theme)).toBeGreaterThanOrEqual(AA_CONTRAST);
  });

  it.each(["gold", "plain"])("the %s pill reads on its own ground", (tone: string) => {
    const pill = `.anime-pill--${tone}`;
    expect(skin.readability(pill, pill, theme)).toBeGreaterThanOrEqual(AA_CONTRAST);
  });

  it("press-button label on its own cream ground", () => {
    expect(skin.readability(".anime-press", ".anime-press", theme)).toBeGreaterThanOrEqual(AA_CONTRAST);
  });
});

describe("the known solid-gold trap stays shut", () => {
  it("never pairs --color-gold-fg with the solid gold, which fails at night", () => {
    expect(skin.paint(".anime-pill--gold", GROUND_COLOR, "day")).toBe(skin.resolve("var(--color-gold-soft)", "day"));
    expect(contrastRatio(tokenValue(DAY, "--color-gold-fg"), tokenValue(DAY, "--color-gold")))
      .toBeLessThan(AA_CONTRAST);
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
  const halo = (theme: Theme): number =>
    contrastRatio(skin.resolve("var(--shadow-3d)", theme), skin.resolve("var(--color-bg)", theme));

  it("keeps the border as the night boundary, above the 3:1 floor", () => {
    const border = skin.resolve("var(--color-border)", "night");
    expect(contrastRatio(border, skin.paint(".anime-press", GROUND_COLOR, "night"))).toBeGreaterThanOrEqual(3);
  });

  it("hangs the day boundary on the 3D halo the night ground cannot carry", () => {
    expect(sharedRuleDeclaration(pressCss, ".anime-press", "box-shadow")).toContain("var(--shadow-3d)");
    expect(halo("day")).toBeGreaterThan(halo("night"));
  });
});
