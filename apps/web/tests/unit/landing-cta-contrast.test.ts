import { describe, expect, it } from "vitest";
import landingCss from "../../src/styles/landing.css?raw";
import globalsCss from "../../src/styles/globals.css?raw";
import {
  contrastRatio,
  normalizeHex,
  parseBlockTokens,
  parseTokens,
  relativeLuminance,
  tokenValue,
  type TokenMap,
} from "./stylesheet-probe";

/* The landing spends both its own scoped tokens and the global ramp, so a
 * resolver that only knows `.landing` would fail to follow `var(--color-*)`. */
const dayTokens: TokenMap = {
  ...parseTokens(globalsCss),
  ...parseBlockTokens(landingCss, ".landing"),
};
const nightTokens: TokenMap = {
  ...dayTokens,
  ...parseBlockTokens(globalsCss, '[data-theme="night"]'),
  ...parseBlockTokens(landingCss, '[data-theme="night"] .landing'),
};

/**
 * One declaration of a landing rule. Unlike the shared `ruleDeclaration`, the
 * property is anchored to the start of a declaration, so asking a chip for
 * `color` cannot come back with its `border-color`.
 */
function ruleDeclaration(selector: string, property: string): string | null {
  const escaped = selector.replaceAll(/[.*+?^${}()|[\]\\]/gu, String.raw`\$&`);
  const body = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, "u").exec(landingCss)?.[1];
  if (body === undefined) throw new Error(`Missing rule: ${selector}`);
  return new RegExp(`(?:^|[;{])\\s*${property}\\s*:\\s*([^;]+)`, "u").exec(body)?.[1]?.trim() ?? null;
}

/** The literal colour a declaration paints, following one level of `var()`. */
function resolve(tokens: TokenMap, declaration: string | null): string {
  if (declaration === null) throw new Error("missing declaration");
  const name = /var\((--[\w-]+)\)/u.exec(declaration)?.[1];
  return normalizeHex(name === undefined ? declaration.trim() : tokenValue(tokens, name));
}

/** Ink-on-ground ratio for a rule that paints both halves of the pair. */
function surfaceContrast(tokens: TokenMap, selector: string): number {
  const foreground = resolve(tokens, ruleDeclaration(selector, "color"));
  const background = resolve(tokens, ruleDeclaration(selector, "background"));
  return contrastRatio(foreground, background);
}

describe("landing colour pairs clear WCAG AA (>= 4.5:1)", () => {
  it.each([
    ".hero-search__cta",
    ".landing__login",
    ".landing__wordmark-accent",
    ".hero-chip--green",
    ".hero-chip--yellow",
    ".hero-chip--blue",
  ])("keeps %s readable by day", (selector) => {
    expect(surfaceContrast(dayTokens, selector)).toBeGreaterThanOrEqual(4.5);
  });

  it.each([".hero-search__cta", ".landing__login", ".landing__wordmark-accent"])(
    "keeps %s readable at night",
    (selector) => {
      expect(surfaceContrast(nightTokens, selector)).toBeGreaterThanOrEqual(4.5);
    },
  );

  it("keeps the hover ground readable too, not just the resting one", () => {
    const ink = resolve(dayTokens, ruleDeclaration(".hero-search__cta", "color"));
    const hover = resolve(dayTokens, ruleDeclaration(".hero-search__cta:hover", "background"));
    expect(contrastRatio(ink, hover)).toBeGreaterThanOrEqual(4.5);
  });
});

describe("explore orange owns the single dominant landing action", () => {
  it("paints Start Exploring with the explore token, never the teal one", () => {
    const background = ruleDeclaration(".hero-search__cta", "background");
    expect(background).toBe("var(--color-explore-action)");
  });

  it("holds the DS explore hue — pumpkin orange, not gold", () => {
    expect(tokenValue(dayTokens, "--color-explore-action")).toBe("#e8742e");
  });

  it("presses into a darker orange so the 3D shadow reads as depth", () => {
    const base = relativeLuminance(tokenValue(dayTokens, "--color-explore-action"));
    const press = relativeLuminance(tokenValue(dayTokens, "--color-explore-action-active"));
    const hover = relativeLuminance(tokenValue(dayTokens, "--color-explore-action-hover"));
    expect(press).toBeLessThan(base);
    expect(hover).toBeGreaterThan(base);
  });

  it("spends the explore press colour on the CTA's 3D shadow", () => {
    const shadow = ruleDeclaration(".hero-search__cta", "box-shadow") ?? "";
    expect(shadow).toContain("var(--color-explore-action-active)");
    expect(shadow).not.toContain("teal");
  });

  it("lifts the orange at night instead of leaving the day value behind", () => {
    const night = parseBlockTokens(globalsCss, '[data-theme="night"]');
    for (const name of ["--color-explore-action", "--color-explore-action-hover", "--color-explore-action-active"]) {
      expect(tokenValue(night, name)).not.toBe(tokenValue(dayTokens, name));
    }
    expect(relativeLuminance(tokenValue(nightTokens, "--color-explore-action")))
      .toBeGreaterThan(relativeLuminance(tokenValue(dayTokens, "--color-explore-action")));
  });
});

describe("the header Login stays a quiet cream pill", () => {
  it("sits on the paper ground with a line border, not a solid brand fill", () => {
    expect(ruleDeclaration(".landing__login", "background")).toBe("var(--landing-paper)");
    expect(ruleDeclaration(".landing__login", "border")).toBe("2px solid var(--landing-line)");
    expect(ruleDeclaration(".landing__login", "color")).toBe("var(--landing-ink)");
  });

  it("carries a 3px pill shadow that sinks 2px under the press", () => {
    expect(ruleDeclaration(".landing__login", "box-shadow"))
      .toBe("0 3px 0 0 var(--landing-shadow-pill)");
    expect(ruleDeclaration(".landing__login:active", "transform")).toBe("translateY(2px)");
    expect(ruleDeclaration(".landing__login:active", "box-shadow"))
      .toBe("0 1px 0 0 var(--landing-shadow-pill)");
  });

  it("darkens that shadow at night so it still reads beneath the pill", () => {
    const pill = relativeLuminance(tokenValue(nightTokens, "--landing-paper"));
    expect(relativeLuminance(tokenValue(nightTokens, "--landing-shadow-pill"))).toBeLessThan(pill);
  });

  it("reads quieter than the explore CTA it now defers to", () => {
    const login = resolve(dayTokens, ruleDeclaration(".landing__login", "background"));
    const cta = resolve(dayTokens, ruleDeclaration(".hero-search__cta", "background"));
    const paper = tokenValue(dayTokens, "--landing-paper");
    expect(contrastRatio(login, paper)).toBeLessThan(contrastRatio(cta, paper));
  });
});

describe("the teal wordmark block keeps its brand ground", () => {
  it("stays bright teal and swaps the ink instead of dimming the brand", () => {
    expect(ruleDeclaration(".landing__wordmark-accent", "background"))
      .toBe("var(--landing-teal)");
    expect(ruleDeclaration(".landing__wordmark-accent", "color"))
      .toBe("var(--landing-teal-ink)");
  });

  it("uses the one ink that clears AA there, where white cannot", () => {
    const teal = tokenValue(dayTokens, "--landing-teal");
    expect(contrastRatio("#ffffff", teal)).toBeLessThan(4.5);
    expect(contrastRatio(tokenValue(dayTokens, "--landing-teal-ink"), teal)).toBeGreaterThanOrEqual(4.5);
  });
});
