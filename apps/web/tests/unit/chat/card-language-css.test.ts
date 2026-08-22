import { describe, expect, it } from "vitest";
import chatCss from "../../../src/styles/chat.css?raw";
import globalsCss from "../../../src/styles/globals.css?raw";
import { contrastRatio, lastRuleDeclaration, parseBlockTokens, parseTokens, ruleDeclaration, tokenValue } from "../stylesheet-probe";

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
  it("keeps only its own padding, the plane coming from card-plane.css", () => {
    expect(ruleDeclaration(chatCss, ".chat-card", "padding")).toBe("0.875rem 1rem");
    expect(ruleDeclaration(chatCss, ".chat-card", "background")).toBeNull();
    expect(ruleDeclaration(chatCss, ".chat-card", "border-radius")).toBeNull();
  });

  it("drops the theme-flipping drop shadow this copy had drifted onto", () => {
    expect(ruleDeclaration(chatCss, ".chat-card", "box-shadow")).toBeNull();
    expect(chatCss).not.toContain("30px -20px");
  });

  it("floats the card above the page floor it sits on", () => {
    const paper = tokenValue(day, "--color-paper");
    const floor = tokenValue(day, "--color-bg");
    expect(contrastRatio(paper, floor)).toBeGreaterThan(1);
  });
});

describe("§4.6 cardPop: a card lands, and yields to the reduce preference", () => {
  it("leaves the entry to the shared plane and keeps no private copy of it", () => {
    expect(ruleDeclaration(chatCss, ".chat-card", "animation")).toBeNull();
    expect(chatCss).not.toContain("@keyframes chat-card-pop");
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
  it("gives every in-thread action the same ground and touch target", () => {
    expect(chatCss).toContain(`${PRESS_FAMILY} {`);
    expect(ruleDeclaration(chatCss, PRESS_FAMILY, "min-height")).toBe("44px");
    expect(ruleDeclaration(chatCss, PRESS_FAMILY, "background")).toBe("var(--color-paper)");
  });

  it("leaves the depth itself to press-3d.css, lift and sink together", () => {
    expect(ruleDeclaration(chatCss, PRESS_FAMILY, "border-radius")).toBeNull();
    expect(ruleDeclaration(chatCss, PRESS_FAMILY, "box-shadow")).toBeNull();
    expect(chatCss).not.toContain("__retry:active");
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
