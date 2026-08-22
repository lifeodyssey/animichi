import { describe, expect, it } from "vitest";
import chatCss from "../../../src/styles/chat.css?raw";
import { ruleDeclaration } from "../stylesheet-probe";

describe("nook tri-color chip tiles", () => {
  it.each([
    ["explore", "var(--color-explore-bg)", "var(--color-explore-fg)"],
    ["walk", "var(--color-walk-bg)", "var(--color-walk-fg)"],
    ["primary", "var(--color-primary-soft)", "var(--color-primary-strong)"],
  ])("colors the %s tile with its semantic token pair", (tone, bg, fg) => {
    const selector = `.chat-chip[data-tone="${tone}"]`;
    expect(ruleDeclaration(chatCss, selector, "background")).toBe(bg);
    expect(ruleDeclaration(chatCss, selector, "color")).toBe(fg);
  });
});

describe("P5 save CTA: cream, so the single gold CTA stays reserved", () => {
  it("inherits the base chip's cream press style", () => {
    expect(ruleDeclaration(chatCss, ".chat-chip", "background")).toBe("var(--color-paper)");
    expect(ruleDeclaration(chatCss, ".chat-chip", "color")).toBe("var(--color-fg)");
  });

  it("declares no tone override at all — a second gold is what the design forbids", () => {
    const toneRules = [...chatCss.matchAll(/\.chat-chip\[data-cta="save"\][^{]*\{([^}]*)\}/g)];
    expect(toneRules).toHaveLength(0);
  });

  it("keeps gold reserved: no chip rule spends a gold token", () => {
    const chipRules = [...chatCss.matchAll(/\.chat-chip[^{]*\{([^}]*)\}/g)].map((match) => match[1] ?? "");
    expect(chipRules.some((body) => body.includes("--color-gold"))).toBe(false);
  });

  it("keeps the saved confirmation and save error on semantic tokens", () => {
    expect(ruleDeclaration(chatCss, ".chat-cta-row__saved", "color")).toBe("var(--color-primary-strong)");
    expect(ruleDeclaration(chatCss, ".chat-cta-row__error", "color")).toBe("var(--color-error-strong)");
  });
});

describe("C3b drill-back chip (issue #437)", () => {
  it("carries layout only, so the cream chip tokens stay the single source", () => {
    expect(ruleDeclaration(chatCss, ".chat-drill__back", "align-self")).toBe("flex-start");
    expect(ruleDeclaration(chatCss, ".chat-drill__back", "background")).toBeNull();
    expect(ruleDeclaration(chatCss, ".chat-drill__back", "color")).toBeNull();
  });
});

describe("A3 chips: pill tiles with a same-family 3D edge", () => {
  it("rounds the chip to a pill and keeps the 44px touch target", () => {
    expect(ruleDeclaration(chatCss, ".chat-chip", "border-radius")).toBe("50px");
    expect(ruleDeclaration(chatCss, ".chat-chip", "min-height")).toBe("44px");
  });

  it("draws the cream chip's edge with the soft line the design uses", () => {
    expect(ruleDeclaration(chatCss, ".chat-chip", "border")).toBe("2px solid var(--color-border-soft)");
  });

  it.each(["explore", "walk", "primary"])("tints the %s tile's edge from its own tone", (tone) => {
    const selector = `.chat-chip[data-tone="${tone}"]`;
    expect(ruleDeclaration(chatCss, selector, "border-color")).toContain("color-mix");
    expect(ruleDeclaration(chatCss, selector, "box-shadow")).toContain("color-mix");
  });
});