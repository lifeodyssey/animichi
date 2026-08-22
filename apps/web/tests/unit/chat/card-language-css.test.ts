import { describe, expect, it } from "vitest";
import chatCss from "../../../src/styles/chat.css?raw";
import globalsCss from "../../../src/styles/globals.css?raw";
import { contrastRatio, lastRuleDeclaration, parseBlockTokens, parseTokens, ruleDeclaration, tokenValue } from "../_token-helpers";

const day = parseTokens(globalsCss);
const night = parseBlockTokens(globalsCss, '[data-theme="night"]');

const PILL_FAMILY = [
  ".chat-spot-card__ep",
  ".chat-card__version-badge",
  ".chat-pacing-pill",
  ".chat-itinerary__capsule",
  ".chat-route-pill",
].join(",\n");

const PRESS_FAMILY = [
  ".chat-error-banner__retry",
  ".chat-fallback__retry",
  ".chat-interruption__retry",
  ".chat-session-expired__login",
  ".chat-session-expired__resume",
  ".chat-budget-exhausted__login",
  ".chat-quota-exhausted__login",
].join(",\n");

describe("§4.1 card shell: one plane for every intent card", () => {
  it("gives the card the design's paper ground, 2px soft line and 18px corner", () => {
    expect(ruleDeclaration(chatCss, ".chat-card", "background")).toBe("var(--color-paper)");
    expect(ruleDeclaration(chatCss, ".chat-card", "border")).toBe("2px solid var(--color-border-soft)");
    expect(ruleDeclaration(chatCss, ".chat-card", "border-radius")).toBe("18px");
    expect(ruleDeclaration(chatCss, ".chat-card", "overflow")).toBe("hidden");
  });

  it("lays the card on a wide soft ground shadow, not the button's hard ledge", () => {
    const shadow = ruleDeclaration(chatCss, ".chat-card", "box-shadow") ?? "";
    expect(shadow).toContain("var(--shadow-3d)");
    expect(shadow).toContain("30px -20px");
    expect(shadow).not.toBe("0 3px 0 var(--shadow-3d)");
  });

  it("floats the card above the page floor it sits on", () => {
    const paper = tokenValue(day, "--color-paper");
    const floor = tokenValue(day, "--color-bg");
    expect(contrastRatio(paper, floor)).toBeGreaterThan(1);
  });
});

describe("§4.6 cardPop: a card lands, and yields to the reduce preference", () => {
  it("settles the card in from 10px below at 0.985 scale", () => {
    expect(ruleDeclaration(chatCss, ".chat-card", "animation")).toBe("chat-card-pop 0.4s cubic-bezier(0.2, 0.8, 0.3, 1)");
    const frames = /@keyframes chat-card-pop \{([\s\S]*?)\n\}/u.exec(chatCss)?.[1] ?? "";
    expect(frames).toContain("translateY(10px) scale(0.985)");
    expect(frames).toContain("opacity: 0");
  });

  it("joins the existing reduced-motion list rather than starting a second one", () => {
    const blocks = [...chatCss.matchAll(/@media \(prefers-reduced-motion: reduce\) \{/gu)];
    expect(blocks).toHaveLength(1);
    const block = /@media \(prefers-reduced-motion: reduce\) \{([\s\S]*)\}/u.exec(chatCss)?.[1] ?? "";
    expect(block).toContain(".chat-card,");
  });
});

describe("§4.3 pill label: one geometry, many grounds", () => {
  it("declares the pill shape once for the whole family", () => {
    expect(chatCss).toContain(`${PILL_FAMILY} {`);
    expect(ruleDeclaration(chatCss, PILL_FAMILY, "border-radius")).toBe("50px");
    expect(ruleDeclaration(chatCss, PILL_FAMILY, "padding")).toBe("3px 10px");
    expect(ruleDeclaration(chatCss, PILL_FAMILY, "font-size")).toBe("11.5px");
    expect(ruleDeclaration(chatCss, PILL_FAMILY, "font-weight")).toBe("900");
    expect(ruleDeclaration(chatCss, PILL_FAMILY, "white-space")).toBe("nowrap");
  });

  it.each([
    [".chat-spot-card__ep", "var(--color-primary-soft)", "var(--color-primary-strong)"],
    [".chat-card__version-badge", "var(--color-muted)", "var(--color-fg)"],
    [".chat-pacing-pill", "var(--color-muted)", "var(--color-fg)"],
    [".chat-itinerary__capsule", "var(--color-walk-bg)", "var(--color-walk-fg)"],
    [".chat-route-pill", "var(--color-gold-soft)", "var(--color-gold-fg)"],
  ])("leaves %s carrying its own ink pair only — no second copy of the shape", (selector, ground, ink) => {
    expect(lastRuleDeclaration(chatCss, selector, "background")).toBe(ground);
    expect(lastRuleDeclaration(chatCss, selector, "color")).toBe(ink);
    expect(lastRuleDeclaration(chatCss, selector, "border-radius")).toBeNull();
    expect(lastRuleDeclaration(chatCss, selector, "font-size")).toBeNull();
  });
});

describe("§4.2 3D press: depth IS the affordance, declared once", () => {
  it("gives every in-thread action the same pill, ledge and touch target", () => {
    expect(chatCss).toContain(`${PRESS_FAMILY} {`);
    expect(ruleDeclaration(chatCss, PRESS_FAMILY, "border-radius")).toBe("50px");
    expect(ruleDeclaration(chatCss, PRESS_FAMILY, "min-height")).toBe("44px");
    expect(ruleDeclaration(chatCss, PRESS_FAMILY, "box-shadow")).toBe("0 3px 0 var(--shadow-3d)");
    expect(ruleDeclaration(chatCss, PRESS_FAMILY, "background")).toBe("var(--color-paper)");
  });

  it("sinks every pressed button 2px onto a shallower ledge", () => {
    const pressed = /\.chat-error-banner__retry:active,([\s\S]*?)\{([^}]*)\}/u.exec(chatCss);
    expect(pressed?.[2]).toContain("transform: translateY(2px)");
    expect(pressed?.[2]).toContain("box-shadow: 0 1px 0 var(--shadow-3d)");
    for (const one of PRESS_FAMILY.split(",\n").slice(1)) {
      expect(pressed?.[1]).toContain(`${one}:active`);
    }
  });
});

describe("§4.5 separators: blocks part solid, rows part dashed", () => {
  it("parts stacked spot rows with a hairline dash mixed from the two line tokens", () => {
    const rule = ruleDeclaration(chatCss, ".chat-spot + .chat-spot", "border-top") ?? "";
    expect(rule).toContain("1px dashed");
    expect(rule).toContain("var(--color-border)");
    expect(rule).toContain("var(--color-border-soft)");
  });

  it("parts a whole block with the design's 2px solid line", () => {
    expect(ruleDeclaration(chatCss, ".chat-short-route", "border-top")).toBe("2px solid var(--color-border-soft)");
  });

  it("strips the spot strip's list chrome so the dashes are the only rule", () => {
    expect(ruleDeclaration(chatCss, ".chat-card__spots", "list-style")).toBe("none");
  });
});

describe("§4.4 picked: the teal ground and the teal depth", () => {
  it("marks a checked spot tile with the primary family, not a grey shadow", () => {
    const selector = ".chat-spot-card:has(.chat-spot-card__check:checked)";
    expect(ruleDeclaration(chatCss, selector, "background")).toBe("var(--color-primary-soft)");
    expect(ruleDeclaration(chatCss, selector, "border-color")).toBe("var(--color-primary)");
    expect(ruleDeclaration(chatCss, selector, "box-shadow")).toBe("0 3px 0 var(--color-primary-strong)");
  });

  it("keeps the tile itself a nested layer on the card plane, never a button", () => {
    expect(ruleDeclaration(chatCss, ".chat-spot-card", "background")).toBe("var(--color-card)");
    expect(ruleDeclaration(chatCss, ".chat-spot-card", "border")).toBe("2px solid var(--color-border-soft)");
    expect(ruleDeclaration(chatCss, ".chat-spot-card", "box-shadow")).toBeNull();
  });
});

describe("the paper ground keeps every ink inside a card above AA", () => {
  it.each([
    ["--color-fg"],
    ["--color-muted-fg"],
    ["--color-error-strong"],
    ["--color-primary-strong"],
  ])("reads %s on the day card plane at 4.5:1 or better", (ink) => {
    const ratio = contrastRatio(tokenValue(day, ink), tokenValue(day, "--color-paper"));
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps the picked tile's own label above AA on its teal ground", () => {
    const ratio = contrastRatio(tokenValue(day, "--color-fg"), tokenValue(day, "--color-primary-soft"));
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps the version badge above AA, which the muted ink pair was not", () => {
    const ratio = contrastRatio(tokenValue(day, "--color-fg"), tokenValue(day, "--color-muted"));
    expect(ratio).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(tokenValue(day, "--color-muted-fg"), tokenValue(day, "--color-muted"))).toBeLessThan(4.5);
  });

  it.each([["--color-fg"], ["--color-muted-fg"]])("reads %s on the night card plane too", (ink) => {
    const ratio = contrastRatio(tokenValue(night, ink), tokenValue(night, "--color-paper"));
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });
});
