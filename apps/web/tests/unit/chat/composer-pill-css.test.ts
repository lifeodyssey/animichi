import { describe, expect, it } from "vitest";
import chatCss from "../../../src/styles/chat.css?raw";
import globalsCss from "../../../src/styles/globals.css?raw";
import {
  contrastRatio,
  gradientStop,
  parseBlockTokens,
  parseTokens,
  referencedTokens,
  ruleDeclaration,
  tokenValue,
} from "../stylesheet-probe";

const day = parseTokens(globalsCss);
const night = parseBlockTokens(globalsCss, '[data-theme="night"]');
const STOPS = [0, 0.25, 0.5, 0.75, 1] as const;

function paletteOf(theme: Record<string, string>, name: string): string {
  return tokenValue({ ...day, ...theme }, name);
}

function gradientRatios(theme: Record<string, string>, selector: string): readonly number[] {
  const [from = "", to = ""] = referencedTokens(ruleDeclaration(chatCss, selector, "background") ?? "");
  const ink = paletteOf(theme, referencedTokens(ruleDeclaration(chatCss, selector, "color") ?? "")[0] ?? "");
  return STOPS.map((stop) =>
    contrastRatio(gradientStop(paletteOf(theme, from), paletteOf(theme, to), stop), ink));
}

describe("G1 composer: a floating pill, not a welded bar", () => {
  it("takes the design's capsule geometry over paper", () => {
    expect(ruleDeclaration(chatCss, ".chat-input", "border-radius")).toBe("50px");
    expect(ruleDeclaration(chatCss, ".chat-input", "border")).toBe("2px solid var(--color-border-soft)");
    expect(ruleDeclaration(chatCss, ".chat-input", "background")).toBe("var(--color-paper)");
    expect(ruleDeclaration(chatCss, ".chat-input", "padding")).toBe("8px 8px 8px 18px");
  });

  it("floats on a soft drop shadow instead of a hard top rule", () => {
    expect(ruleDeclaration(chatCss, ".chat-input", "box-shadow")).toBe("0 12px 28px -16px var(--shadow-3d)");
    expect(ruleDeclaration(chatCss, ".chat-input", "border-top")).toBeNull();
  });

  it("lets the field disappear into the pill", () => {
    expect(ruleDeclaration(chatCss, ".chat-input__field", "border")).toBe("0");
    expect(ruleDeclaration(chatCss, ".chat-input__field", "background")).toBe("transparent");
    expect(ruleDeclaration(chatCss, ".chat-input__field::placeholder", "color")).toBe("var(--color-muted-fg)");
  });
});

describe("G2 focus: the design's teal edge plus a ring that carries the contrast", () => {
  it("answers any focus inside the pill with the teal edge", () => {
    expect(ruleDeclaration(chatCss, ".chat-input:focus-within", "border-color")).toBe("var(--color-primary)");
  });

  it("rings the pill for keyboard focus and drops the field's own outline", () => {
    const ring = ruleDeclaration(chatCss, ".chat-input:has(.chat-input__field:focus-visible)", "box-shadow") ?? "";
    expect(ring).toContain("0 0 0 2px var(--color-focus)");
    expect(ring).toContain("0 0 0 4px var(--color-primary-strong)");
    expect(ruleDeclaration(chatCss, ".chat-input__field:focus-visible", "outline")).toBe("none");
  });

  it("carries 1.4.11's 3:1 on the outer band, which the teal edge alone cannot", () => {
    const paper = tokenValue(day, "--color-paper");
    const strong = tokenValue(day, "--color-primary-strong");
    expect(contrastRatio(strong, paper)).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(strong, tokenValue(day, "--color-bg"))).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(tokenValue(day, "--color-primary"), paper)).toBeLessThan(3);
  });
});

describe("G3 send key: the press shadow is the affordance", () => {
  it("wears the 3D press shadow while it can be pressed", () => {
    expect(ruleDeclaration(chatCss, ".chat-input__send", "box-shadow")).toBe("0 3px 0 var(--color-primary-strong)");
    expect(ruleDeclaration(chatCss, ".chat-input__send", "background")).toBe("var(--color-primary)");
    expect(ruleDeclaration(chatCss, ".chat-input__send:active", "transform")).toBe("translateY(2px)");
  });

  it("goes flat and muted when there is nothing to send", () => {
    expect(ruleDeclaration(chatCss, ".chat-input__send:disabled", "box-shadow")).toBe("none");
    expect(ruleDeclaration(chatCss, ".chat-input__send:disabled", "background")).toBe("var(--color-muted)");
    expect(ruleDeclaration(chatCss, ".chat-input__send:disabled", "color")).toBe("var(--color-muted-fg)");
  });

  it("keeps both round keys on the 44px AAA target, above the design's 42/36", () => {
    expect(ruleDeclaration(chatCss, ".chat-input__send", "width")).toBe("44px");
    expect(ruleDeclaration(chatCss, ".chat-input__send", "height")).toBe("44px");
    expect(ruleDeclaration(chatCss, ".chat-input__settings", "width")).toBe("44px");
    expect(ruleDeclaration(chatCss, ".chat-input__settings", "height")).toBe("44px");
  });

  it("leaves the quiet key without a press shadow so the send key owns the emphasis", () => {
    expect(ruleDeclaration(chatCss, ".chat-input__settings", "box-shadow")).toBeNull();
    expect(ruleDeclaration(chatCss, ".chat-input__settings", "border-radius")).toBe("50%");
  });
});

describe("G4 busy: the running turn dims the dock, it does not remove it", () => {
  it("dims the pill the way the design's `.composer.busy` does", () => {
    expect(ruleDeclaration(chatCss, ".chat-input--busy", "opacity")).toBe("0.75");
  });
});

describe("B2c mood card / D9 scene fallback: AA at every point of the gradient", () => {
  it.each([".chat-mood", ".chat-scene-thumb--fallback"])("clears 4.5:1 across %s by day", (selector) => {
    expect(Math.min(...gradientRatios({}, selector))).toBeGreaterThanOrEqual(4.5);
  });

  it("clears 4.5:1 at night too, where --color-primary-fg would invert to an ink", () => {
    const NIGHT_CARDS = '[data-theme="night"] .chat-mood,\n[data-theme="night"] .chat-scene-thumb--fallback';
    expect(Math.min(...gradientRatios(night, NIGHT_CARDS))).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(tokenValue(night, "--color-primary-fg"), tokenValue(day, "--color-primary-strong"))).toBeLessThan(4.5);
  });

  it("would have broken at the light end on the old primary gradient", () => {
    const white = tokenValue(day, "--color-primary-fg");
    expect(contrastRatio(tokenValue(day, "--color-primary"), white)).toBeLessThan(4.5);
  });
});
