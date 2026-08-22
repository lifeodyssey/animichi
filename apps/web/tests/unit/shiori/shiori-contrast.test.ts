import { describe, expect, it } from "vitest";
import globalsCss from "../../../src/styles/globals.css?raw";
import css from "../../../src/styles/shiori.css?raw";
import photosCss from "../../../src/styles/shiori-photos.css?raw";
import generatorCss from "../../../src/styles/shiori-generator.css?raw";
import {
  contrastRatio,
  lastRuleDeclaration,
  normalizeHex,
  parseBlockTokens,
  ruleDeclaration,
  tokenValue,
} from "../stylesheet-probe";
import type { TokenMap } from "../stylesheet-probe";

/** WCAG 1.4.3 AA for the しおり skin in both themes and its saved artifact. */
const DAY: TokenMap = parseBlockTokens(globalsCss, ":root");
const NIGHT: TokenMap = parseBlockTokens(globalsCss, '[data-theme="night"]');
const LOCAL: TokenMap = parseBlockTokens(css, ".shiori-card");

const AA = 4.5;

/** `color` / `background`, never `border-color` — the parser interpolates raw. */
const TEXT = String.raw`(?<![-\w])color`;
const GROUND = String.raw`(?<![-\w])background`;

function palette(night: boolean): TokenMap {
  return night ? { ...DAY, ...LOCAL, ...NIGHT } : { ...DAY, ...LOCAL };
}

/** Follow a declared value through its `var(--…)` chain to a literal colour. */
function resolve(value: string, night: boolean): string {
  const target = /var\((--[\w-]+)\)/u.exec(value)?.[1];
  if (target === undefined) return value;
  return resolve(tokenValue(palette(night), target), night);
}

/** The colour a rule really paints, as the browser would compute it. */
function paint(sheet: string, selector: string, property: string, night: boolean): string {
  const declared = lastRuleDeclaration(sheet, selector, property);
  if (declared === null) throw new Error(`${selector} declares no ${property}`);
  return resolve(declared, night);
}

function readability(sheet: string, selector: string, ground: string, night: boolean): number {
  return contrastRatio(paint(sheet, selector, TEXT, night), paint(sheet, ground, GROUND, night));
}

describe("every surface the skin paints has a night override", () => {
  it.each(["--color-paper", "--color-card", "--color-muted", "--color-border-soft"])(
    "%s flips for night, so no day cream is left on the dark floor", (name: string) => {
      expect(NIGHT[name]).toBeDefined();
    },
  );

  it("repaints the card ground itself, not just the text on it", () => {
    expect(paint(css, ".shiori-card", GROUND, true)).not.toBe(paint(css, ".shiori-card", GROUND, false));
  });
});

describe.each([
  ["day", false],
  ["night", true],
])("text contrast on the %s surfaces", (_label, night: boolean) => {
  it("keeps heading copy readable on the card paper", () => {
    expect(readability(css, ".shiori-head__eyebrow", ".shiori-card", night)).toBeGreaterThanOrEqual(AA);
    expect(readability(css, ".shiori-head__sub", ".shiori-card", night)).toBeGreaterThanOrEqual(AA);
  });

  it("keeps the window pill readable on its own ground", () => {
    expect(readability(css, ".shiori-window", ".shiori-window", night)).toBeGreaterThanOrEqual(AA);
  });

  it("keeps the poster check readable on its own ground", () => {
    expect(readability(css, ".shiori-poster-stop__check", ".shiori-poster-stop__check", night))
      .toBeGreaterThanOrEqual(AA);
  });

  it("keeps completion readable on its soft gold ground", () => {
    expect(readability(generatorCss, ".shiori-generator__completion", ".shiori-generator__completion", night))
      .toBeGreaterThanOrEqual(AA);
  });

  it("keeps generator stats readable on the paper ground", () => {
    expect(contrastRatio(
      paint(generatorCss, ".shiori-generator__stats", TEXT, night),
      resolve("var(--color-paper)", night),
    )).toBeGreaterThanOrEqual(AA);
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
    )).toBeGreaterThanOrEqual(AA);
  });

  it("keeps gold seal ink readable on solid gold", () => {
    expect(contrastRatio(
      tokenValue(LOCAL, "--shiori-gold-ink"),
      tokenValue(DAY, "--color-gold"),
    )).toBeGreaterThanOrEqual(AA);
  });

  it("keeps the plus-N scrim readable over the brightest possible photo", () => {
    const ratio = contrastRatio(scrimOver("#ffffff"), tokenValue(LOCAL, "--shiori-export-ink"));
    expect(ratio).toBeGreaterThanOrEqual(AA);
    expect(ratio).toBeCloseTo(5.54, 2);
  });

  it("does not reuse --color-gold-fg for solid gold", () => {
    const ink = tokenValue(LOCAL, "--shiori-gold-ink");
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
    )).toBeGreaterThanOrEqual(AA);
  });
});
