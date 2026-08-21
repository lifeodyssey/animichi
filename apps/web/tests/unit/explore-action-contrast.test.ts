import { describe, expect, it } from "vitest";
import globalsCss from "../../src/styles/globals.css?raw";
import {
  contrastRatio,
  normalizeHex,
  parseBlockTokens,
  parseTokens,
  relativeLuminance,
  tokenValue,
  type TokenMap,
} from "./_token-helpers";

const AA = 4.5;
const dayTokens = parseTokens(globalsCss);
const nightTokens: TokenMap = { ...dayTokens, ...parseBlockTokens(globalsCss, '[data-theme="night"]') };

/**
 * One declaration of a globals rule. Unlike the shared `ruleDeclaration`, the
 * property is anchored to the start of a declaration, so asking a button for
 * `color` cannot come back with its `border-color`.
 */
function ruleDeclaration(css: string, selector: string, property: string): string | null {
  const escaped = selector.replaceAll(/[.*+?^${}()|[\]\\]/gu, String.raw`\$&`);
  const body = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, "u").exec(css)?.[1];
  if (body === undefined) throw new Error(`Missing rule: ${selector}`);
  return new RegExp(`(?:^|[;{}]|\\*/)\\s*${property}\\s*:\\s*([^;]+)`, "u").exec(body)?.[1]?.trim() ?? null;
}

/** The literal colour a declaration paints, following one level of `var()`. */
function resolve(tokens: TokenMap, declaration: string | null): string {
  if (declaration === null) throw new Error("missing declaration");
  const name = /var\((--[\w-]+)\)/u.exec(declaration)?.[1];
  return normalizeHex(name === undefined ? declaration.trim() : tokenValue(tokens, name));
}

function submitContrast(tokens: TokenMap, ground: string): number {
  const ink = resolve(tokens, ruleDeclaration(globalsCss, ".login-modal .ds-button--primary", "color"));
  return contrastRatio(ink, tokenValue(tokens, ground));
}

describe("the explore action ramp lives in :root, not in a page scope", () => {
  it("holds DESIGN.md's pumpkin orange as the resting ground", () => {
    expect(tokenValue(dayTokens, "--color-explore-action")).toBe("#e8742e");
  });

  it("keeps hover lighter and press darker than that base", () => {
    const base = relativeLuminance(tokenValue(dayTokens, "--color-explore-action"));
    expect(relativeLuminance(tokenValue(dayTokens, "--color-explore-action-hover"))).toBeGreaterThan(base);
    expect(relativeLuminance(tokenValue(dayTokens, "--color-explore-action-active"))).toBeLessThan(base);
  });

  it("lifts the whole ramp at night rather than reusing the day values", () => {
    const night = parseBlockTokens(globalsCss, '[data-theme="night"]');
    const names = ["--color-explore-action", "--color-explore-action-hover", "--color-explore-action-active"];
    expect(names.map((name) => tokenValue(night, name)))
      .not.toEqual(names.map((name) => tokenValue(dayTokens, name)));
    expect(relativeLuminance(tokenValue(nightTokens, "--color-explore-action")))
      .toBeGreaterThan(relativeLuminance(tokenValue(dayTokens, "--color-explore-action")));
  });

  it("stays a separate family from the teal explore-mode tint", () => {
    expect(tokenValue(dayTokens, "--color-explore-action"))
      .not.toBe(tokenValue(dayTokens, "--color-explore-bg"));
  });
});

describe("the login modal's submit clears WCAG AA", () => {
  it("no longer paints white on the bright brand teal", () => {
    expect(contrastRatio("#ffffff", tokenValue(dayTokens, "--color-primary"))).toBeLessThan(AA);
    expect(ruleDeclaration(globalsCss, ".login-modal .ds-button--primary", "background"))
      .toBe("var(--color-explore-action)");
  });

  it("reads by day on the resting ground", () => {
    expect(submitContrast(dayTokens, "--color-explore-action")).toBeGreaterThanOrEqual(AA);
  });

  it("reads by day on the hover ground too", () => {
    expect(ruleDeclaration(globalsCss, ".login-modal .ds-button--primary:hover", "background"))
      .toBe("var(--color-explore-action-hover)");
    expect(submitContrast(dayTokens, "--color-explore-action-hover")).toBeGreaterThanOrEqual(AA);
  });

  it("reads at night on both the resting and hover grounds", () => {
    expect(submitContrast(nightTokens, "--color-explore-action")).toBeGreaterThanOrEqual(AA);
    expect(submitContrast(nightTokens, "--color-explore-action-hover")).toBeGreaterThanOrEqual(AA);
  });

  it("presses into the darker orange so the 3D shadow reads as depth", () => {
    expect(ruleDeclaration(globalsCss, ".login-modal .ds-button--primary:active", "box-shadow"))
      .toBe("0 1px 0 0 var(--color-explore-action-active)");
    expect(ruleDeclaration(globalsCss, ".login-modal .ds-button--primary:active", "transform"))
      .toBe("translateY(3px)");
  });
});

describe("the generic primary button keeps its accessible teal", () => {
  it("still grounds white text on the strong teal, which clears AA", () => {
    const ink = resolve(dayTokens, ruleDeclaration(globalsCss, ".ds-button--primary", "color"));
    const ground = resolve(dayTokens, ruleDeclaration(globalsCss, ".ds-button--primary", "background"));
    expect(ground).toBe(normalizeHex(tokenValue(dayTokens, "--color-primary-strong")));
    expect(contrastRatio(ink, ground)).toBeGreaterThanOrEqual(AA);
  });
});
