import { describe, expect, it } from "vitest";
import globalsCss from "../../../src/styles/globals.css?raw";
import cardPlaneCss from "../../../src/styles/card-plane.css?raw";
import css from "../../../src/styles/shiori.css?raw";
import photosCss from "../../../src/styles/shiori-photos.css?raw";
import generatorCss from "../../../src/styles/shiori-generator.css?raw";
import {
  AA_CONTRAST,
  SkinContrast,
  TEXT_COLOR,
  contrastRatio,
  lastRuleDeclaration,
  normalizeHex,
  parseBlockTokens,
  ruleDeclaration,
  sharedRuleDeclaration,
  tokenValue,
} from "../stylesheet-probe";
import type { Theme, TokenMap } from "../stylesheet-probe";

/** WCAG 1.4.3 AA for the しおり skin in both themes and its saved artifact. */
const DAY: TokenMap = parseBlockTokens(globalsCss, ":root");
const NIGHT: TokenMap = parseBlockTokens(globalsCss, '[data-theme="night"]');
const LOCAL: TokenMap = parseBlockTokens(css, ".shiori-card");

/** Both sheets read under one palette; the cascade decides, so last rule wins.
 * `LOCAL` goes on top of the night overrides as well as the day ones: it is
 * declared on `.shiori-card` itself, which outranks `[data-theme="night"]` on
 * `:root` for every element in the card. That is what makes the exported
 * artifact theme-invariant (export-theme-invariance.test.ts). */
const themed = {
  day: { ...DAY, ...LOCAL },
  declarationOf: lastRuleDeclaration,
  night: { ...NIGHT, ...LOCAL },
};
/* The card plane lives in card-plane.css now; it is read alongside this skin,
 * shared sheet first because the layer makes it lose to the skin's own rules. */
const card = new SkinContrast({
  ...themed,
  sheet: `${cardPlaneCss}\n${css}`,
  declarationOf: sharedRuleDeclaration,
});
/* The generator is the chrome AROUND the card, not part of the saved artifact,
 * so it reads the plain themed palette and is expected to repaint at night. */
const generator = new SkinContrast({
  day: DAY,
  declarationOf: lastRuleDeclaration,
  night: NIGHT,
  sheet: generatorCss,
});

describe.each(["day", "night"] as const)("text contrast on the %s surfaces", (theme: Theme) => {
  it("keeps heading copy readable on the card paper", () => {
    expect(card.readability(".shiori-head__eyebrow", ".shiori-card", theme)).toBeGreaterThanOrEqual(AA_CONTRAST);
    expect(card.readability(".shiori-head__sub", ".shiori-card", theme)).toBeGreaterThanOrEqual(AA_CONTRAST);
  });

  it("keeps the window pill readable on its own ground", () => {
    expect(card.readability(".shiori-window", ".shiori-window", theme)).toBeGreaterThanOrEqual(AA_CONTRAST);
  });

  it("keeps the poster check readable on its own ground", () => {
    expect(card.readability(".shiori-poster-stop__check", ".shiori-poster-stop__check", theme))
      .toBeGreaterThanOrEqual(AA_CONTRAST);
  });

  it("keeps completion readable on its soft gold ground", () => {
    expect(generator.readability(".shiori-generator__completion", ".shiori-generator__completion", theme))
      .toBeGreaterThanOrEqual(AA_CONTRAST);
  });

  it("keeps generator stats readable on the paper ground", () => {
    expect(contrastRatio(
      generator.paint(".shiori-generator__stats", TEXT_COLOR, theme),
      generator.resolve("var(--color-paper)", theme),
    )).toBeGreaterThanOrEqual(AA_CONTRAST);
  });
});

function scrimOver(photoHex: string): string {
  const declaration = ruleDeclaration(photosCss, ".shiori-grid__overflow", "background");
  if (declaration === null) throw new Error("Missing shiori overflow background");
  const percent = /var\(--shiori-export-ground\)\s+([\d.]+)%/u.exec(declaration)?.[1];
  if (percent === undefined) throw new Error("Missing shiori scrim percentage");

  const amount = Number(percent) / 100;
  const ground = normalizeHex(tokenValue(LOCAL, "--shiori-export-ground")).slice(1);
  const photo = normalizeHex(photoHex).slice(1);
  const channels = [0, 2, 4].map((offset) => Math.round(
    Number.parseInt(ground.slice(offset, offset + 2), 16) * amount +
    Number.parseInt(photo.slice(offset, offset + 2), 16) * (1 - amount),
  ));
  return `#${channels.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

describe("exported artifact", () => {
  it("keeps export ink readable on export ground", () => {
    expect(contrastRatio(
      tokenValue(LOCAL, "--shiori-export-ink"),
      tokenValue(LOCAL, "--shiori-export-ground"),
    )).toBeGreaterThanOrEqual(AA_CONTRAST);
  });

  it("keeps gold seal ink readable on solid gold", () => {
    expect(contrastRatio(
      tokenValue(DAY, "--color-gold-ink"),
      tokenValue(DAY, "--color-gold"),
    )).toBeGreaterThanOrEqual(AA_CONTRAST);
  });

  it("keeps the plus-N scrim readable over the brightest possible photo", () => {
    const ratio = contrastRatio(scrimOver("#ffffff"), tokenValue(LOCAL, "--shiori-export-ink"));
    expect(ratio).toBeGreaterThanOrEqual(AA_CONTRAST);
    expect(ratio).toBeCloseTo(5.54, 2);
  });

  it("does not reuse --color-gold-fg for solid gold", () => {
    const ink = tokenValue(DAY, "--color-gold-ink");
    expect(ink).not.toBe(tokenValue(DAY, "--color-gold-fg"));
    expect(ink).not.toBe(tokenValue(NIGHT, "--color-gold-fg"));
  });

  it.each([
    ".shiori-card--poster-fallback .shiori-head__title",
    ".shiori-card--poster-fallback .shiori-poster-stop__name",
    ".shiori-card--poster-fallback .shiori-poster-stop__time",
  ])("uses export ink for %s instead of resolving inherit", (selector: string) => {
    expect(lastRuleDeclaration(css, selector, "color")).toBe("inherit");
    expect(contrastRatio(
      tokenValue(LOCAL, "--shiori-export-ink"),
      tokenValue(LOCAL, "--shiori-export-ground"),
    )).toBeGreaterThanOrEqual(AA_CONTRAST);
  });
});
