import { describe, expect, it } from "vitest";
import cardPlaneCss from "../../../src/styles/card-plane.css?raw";
import globalsCss from "../../../src/styles/globals.css?raw";
import css from "../../../src/styles/shiori.css?raw";
import photosCss from "../../../src/styles/shiori-photos.css?raw";
import {
  SkinContrast,
  lastRuleDeclaration,
  normalizeHex,
  parseBlockTokens,
  referencedTokens,
  ruleDeclaration,
  sharedRuleDeclaration,
  tokenValue,
} from "../stylesheet-probe";
import type { TokenMap } from "../stylesheet-probe";

/**
 * A しおり is saved as a 1080×1920 image, so the theme the viewer happened to be
 * in when they pressed save must not be baked into the file. Only the poster
 * fallback used to hold that line, on its own export ground and ink; the other
 * three layouts painted themselves with `--color-paper` and `--color-fg` and
 * inverted at night. `.shiori-card` now freezes the whole palette its subtree
 * spends, and this suite is what says so for all four.
 */
const DAY: TokenMap = parseBlockTokens(globalsCss, ":root");
const NIGHT: TokenMap = parseBlockTokens(globalsCss, '[data-theme="night"]');
const EXPORT: TokenMap = parseBlockTokens(css, ".shiori-card");

/** Every sheet that paints inside the card, the shared plane included. */
const INSIDE_THE_CARD = `${cardPlaneCss}\n${css}\n${photosCss}`;

const card = new SkinContrast({
  day: { ...DAY, ...EXPORT },
  declarationOf: sharedRuleDeclaration,
  night: { ...NIGHT, ...EXPORT },
  sheet: INSIDE_THE_CARD,
});

/**
 * Each layout with the ground its saved image is painted on and the rule its
 * stop names take their ink from. Three share the card's own; the poster
 * fallback brings its own export palette. Naming both per row is what lets
 * every case assert one contract instead of branching on the layout.
 */
const LAYOUTS = [
  { layout: "ticket", ground: ".shiori-card", ink: ".shiori-stop__name" },
  { layout: "album-grid", ground: ".shiori-card", ink: ".shiori-stop__name" },
  { layout: "single-panel", ground: ".shiori-card", ink: ".shiori-stop__name" },
  {
    layout: "poster-fallback",
    ground: ".shiori-card--poster-fallback",
    ink: ".shiori-poster-stop__name",
  },
] as const;

describe.each(LAYOUTS)("the $layout artifact is the same file in either theme", ({ ground, ink }) => {
  it("lands on one ground, not a day one and a night one", () => {
    expect(card.paint(ground, "background", "night")).toBe(card.paint(ground, "background", "day"));
  });

  it("prints its stop names in one ink", () => {
    expect(card.paint(ink, "color", "night")).toBe(card.paint(ink, "color", "day"));
  });
});

describe("no colour anywhere inside the card follows the theme", () => {
  const spent = [...new Set(
    [...INSIDE_THE_CARD.matchAll(/:[^;{}]*var\((--[\w-]+)[^;{}]*/gu)]
      .flatMap((declaration) => referencedTokens(declaration[0]))
      .filter((name) => name.startsWith("--color-")),
  )];

  it("spends the tokens the しおり is drawn with", () => {
    expect(spent).toContain("--color-paper");
    expect(spent).toContain("--color-fg");
    expect(spent.length).toBeGreaterThanOrEqual(9);
  });

  it.each(spent)("%s resolves to one value in both themes", (name: string) => {
    expect(card.resolve(`var(${name})`, "night")).toBe(card.resolve(`var(${name})`, "day"));
  });
});

describe("the frozen palette is the design's, not a second palette", () => {
  const frozen = Object.keys(EXPORT).filter((name) => name.startsWith("--color-"));

  it("freezes every theme token the card subtree spends, and no more", () => {
    expect([...frozen].sort()).toStrictEqual([
      "--color-bg", "--color-border", "--color-border-soft", "--color-card",
      "--color-fg", "--color-muted-fg", "--color-paper",
    ]);
  });

  it.each(frozen)("%s is frozen at the globals day value", (name: string) => {
    expect(normalizeHex(tokenValue(EXPORT, name))).toBe(normalizeHex(tokenValue(DAY, name)));
  });

  it.each(frozen)("%s is a token the night theme would otherwise have flipped", (name: string) => {
    expect(NIGHT[name]).toBeDefined();
    expect(normalizeHex(NIGHT[name] ?? "")).not.toBe(normalizeHex(tokenValue(EXPORT, name)));
  });
});

describe("a translucent ground still belongs to the artifact", () => {
  /* The poster's top stop is 74% ground on transparent, and its `background`
   * shorthand replaces the shared plane's rather than sitting on it. As one
   * layer, what showed through was the page floor: 63% of the poster's pixels
   * still changed with the theme after the palette was frozen, which is what
   * the pixel comparison of the two screenshots caught. */
  it("names the frozen floor as its own bottom layer", () => {
    const ground = ruleDeclaration(css, ".shiori-card--poster-fallback", "background") ?? "";
    expect(ground).toContain("transparent");
    expect(referencedTokens(ground).at(-1)).toBe("--color-bg");
  });
});

describe("the card still reads its plane off the shared rule", () => {
  it("keeps a card plane it shares with the other three families", () => {
    expect(lastRuleDeclaration(css, ".shiori-card", "background")).toBeNull();
    expect(sharedRuleDeclaration(INSIDE_THE_CARD, ".shiori-card", "background"))
      .toBe("var(--color-paper)");
    expect(cardPlaneCss).toContain(".shiori-card");
  });
});
