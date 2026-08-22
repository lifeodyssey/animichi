import { describe, expect, it } from "vitest";
import chatCss from "../../src/styles/chat.css?raw";
import globalsCss from "../../src/styles/globals.css?raw";
import {
  contrastRatio,
  lastRuleDeclaration,
  normalizeHex,
  parseBlockTokens,
  parseTokens,
  ruleDeclaration,
  tokenValue,
  type TokenMap,
} from "./stylesheet-probe";

const AA = 4.5;
const dayTokens = parseTokens(globalsCss);
const nightTokens: TokenMap = { ...dayTokens, ...parseBlockTokens(globalsCss, '[data-theme="night"]') };

/** The literal hex a declaration paints, following one level of `var()`. */
function paintAsHex(tokens: TokenMap, declaration: string | null): string {
  if (declaration === null) throw new Error("missing declaration");
  const name = /var\((--[\w-]+)\)/u.exec(declaration)?.[1];
  return normalizeHex(name === undefined ? declaration.trim() : tokenValue(tokens, name));
}

describe("the solid gold ground carries its own theme-invariant ink", () => {
  it("names the design-sync gold ink", () => {
    expect(tokenValue(dayTokens, "--color-gold-ink")).toBe("#5c4813");
  });

  it("never flips at night, because the gold under it never flips", () => {
    const night = parseBlockTokens(globalsCss, '[data-theme="night"]');
    expect(night["--color-gold"]).toBeUndefined();
    expect(night["--color-gold-ink"]).toBeUndefined();
  });
});

describe("the recompute action reads on solid gold in both themes", () => {
  it("paints gold ink on the solid gold ground", () => {
    expect(ruleDeclaration(chatCss, ".chat-selection-tray__action", "background"))
      .toBe("var(--color-gold)");
    expect(ruleDeclaration(chatCss, ".chat-selection-tray__action", "color"))
      .toBe("var(--color-gold-ink)");
  });

  it("clears AA by day", () => {
    const ink = paintAsHex(dayTokens, ruleDeclaration(chatCss, ".chat-selection-tray__action", "color"));
    const ground = paintAsHex(dayTokens, ruleDeclaration(chatCss, ".chat-selection-tray__action", "background"));
    expect(contrastRatio(ink, ground)).toBeGreaterThanOrEqual(AA);
  });

  it("clears AA at night", () => {
    const ink = paintAsHex(nightTokens, ruleDeclaration(chatCss, ".chat-selection-tray__action", "color"));
    const ground = paintAsHex(nightTokens, ruleDeclaration(chatCss, ".chat-selection-tray__action", "background"));
    expect(contrastRatio(ink, ground)).toBeGreaterThanOrEqual(AA);
  });
});

describe("the tinted gold ground keeps its own foreground", () => {
  it("keeps the route pill on the soft pair", () => {
    expect(lastRuleDeclaration(chatCss, ".chat-route-pill", "background")).toBe("var(--color-gold-soft)");
    expect(lastRuleDeclaration(chatCss, ".chat-route-pill", "color")).toBe("var(--color-gold-fg)");
  });

  it("clears AA on the soft pair in both themes", () => {
    for (const tokens of [dayTokens, nightTokens]) {
      const ink = paintAsHex(tokens, lastRuleDeclaration(chatCss, ".chat-route-pill", "color"));
      const ground = paintAsHex(tokens, lastRuleDeclaration(chatCss, ".chat-route-pill", "background"));
      expect(contrastRatio(ink, ground)).toBeGreaterThanOrEqual(AA);
    }
  });
});

describe("the soft foreground never rides the solid ground", () => {
  it("keeps --color-gold-fg off any solid-gold rule", () => {
    const solidBackground = /background:\s*var\(--color-gold\)/u;
    const bodies = [...chatCss.matchAll(/\{([^}]*)\}/gu)].map((match) => match[1] ?? "");
    const offenders = bodies.filter((body) =>
      solidBackground.test(body) && body.includes("var(--color-gold-fg)"));
    expect(offenders).toEqual([]);
  });
});