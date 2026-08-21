import { describe, expect, it } from "vitest";
import chatCss from "../../../src/styles/chat.css?raw";
import globalsCss from "../../../src/styles/globals.css?raw";
import {
  contrastRatio,
  parseBlockTokens,
  parseTokens,
  ruleDeclaration,
  tokenValue,
} from "../_token-helpers";

const day = parseTokens(globalsCss);
const night = parseBlockTokens(globalsCss, '[data-theme="night"]');

const CONTROLS = ".chat-appbar__new,\n.chat-appbar__login";
const CONTROLS_PRESS = ".chat-appbar__new:active,\n.chat-appbar__login:active";
const CONTROLS_FOCUS = ".chat-appbar__new:focus-visible,\n.chat-appbar__login:focus-visible";

describe("appbar chrome: the chat's top rule", () => {
  it("takes the design's paper ground and a 2px bottom rule", () => {
    expect(ruleDeclaration(chatCss, ".chat-appbar", "background")).toBe("var(--color-paper)");
    expect(ruleDeclaration(chatCss, ".chat-appbar", "border-bottom")).toBe("2px solid var(--color-border-soft)");
    expect(ruleDeclaration(chatCss, ".chat-appbar", "padding")).toBe("13px clamp(16px, 4vw, 28px)");
    expect(ruleDeclaration(chatCss, ".chat-appbar", "flex")).toBe("none");
  });

  it("stacks the fox over the torii at the brand mark", () => {
    expect(ruleDeclaration(chatCss, ".chat-appbar__mark", "position")).toBe("relative");
    expect(ruleDeclaration(chatCss, ".chat-appbar__fox", "position")).toBe("absolute");
    expect(ruleDeclaration(chatCss, ".chat-appbar__fox", "transform")).toBe("scaleX(-1)");
  });

  it("sets the wordmark name line in the rounded display face", () => {
    expect(ruleDeclaration(chatCss, ".chat-appbar__name", "font-family")).toContain("Zen Maru Gothic");
  });
});

describe("appbar tagline: AA by day, the bright teal by night", () => {
  it("is written in the deep teal, the only member of the family that clears 4.5:1 on day paper", () => {
    expect(ruleDeclaration(chatCss, ".chat-appbar__tagline", "color")).toBe("var(--color-primary-strong)");
    expect(contrastRatio(tokenValue(day, "--color-primary-strong"), tokenValue(day, "--color-paper"))).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(tokenValue(day, "--color-primary"), tokenValue(day, "--color-paper"))).toBeLessThan(4.5);
  });

  it("swaps to the bright teal at night, which clears 4.5:1 there", () => {
    expect(ruleDeclaration(chatCss, '[data-theme="night"] .chat-appbar__tagline', "color")).toBe("var(--color-primary)");
    expect(contrastRatio(tokenValue(day, "--color-primary"), tokenValue(night, "--color-paper"))).toBeGreaterThanOrEqual(4.5);
  });
});

describe("appbar controls: 44px targets with a 3D press and a visible ring", () => {
  it("keeps both controls on the AAA target with the press shadow", () => {
    expect(ruleDeclaration(chatCss, CONTROLS, "min-height")).toBe("44px");
    expect(ruleDeclaration(chatCss, CONTROLS, "min-width")).toBe("44px");
    expect(ruleDeclaration(chatCss, CONTROLS, "box-shadow")).toBe("0 3px 0 var(--shadow-3d)");
    expect(ruleDeclaration(chatCss, CONTROLS, "border-radius")).toBe("50px");
    expect(ruleDeclaration(chatCss, CONTROLS_PRESS, "transform")).toBe("translateY(2px)");
  });

  it("carries a visible keyboard ring on focus", () => {
    expect(ruleDeclaration(chatCss, CONTROLS_FOCUS, "outline")).toBe("2px solid var(--color-focus)");
  });
});

describe("night line stack: the operable floor for the pill", () => {
  it("keeps the soft line above 3:1 on night paper, quieter than the loud border", () => {
    const softRatio = contrastRatio(tokenValue(night, "--color-border-soft"), tokenValue(night, "--color-paper"));
    const loudRatio = contrastRatio(tokenValue(night, "--color-border"), tokenValue(night, "--color-paper"));
    expect(softRatio).toBeGreaterThanOrEqual(3);
    expect(loudRatio).toBeGreaterThan(softRatio);
  });

  it("keeps the composer pill findable unfocused: its border token clears 3:1 at night", () => {
    expect(ruleDeclaration(chatCss, ".chat-input", "border")).toBe("2px solid var(--color-border-soft)");
    expect(contrastRatio(tokenValue(night, "--color-border-soft"), tokenValue(night, "--color-paper"))).toBeGreaterThanOrEqual(3);
  });
});

describe("dock rail: shares the composer's centred column", () => {
  it("uses the same width as the pill and centres itself", () => {
    expect(ruleDeclaration(chatCss, ".chat-dock", "width")).toBe(ruleDeclaration(chatCss, ".chat-input", "width"));
    expect(ruleDeclaration(chatCss, ".chat-dock", "margin-inline")).toBe("auto");
  });
});
