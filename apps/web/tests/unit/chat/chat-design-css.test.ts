import { describe, expect, it } from "vitest";
import chatCss from "../../../src/styles/chat.css?raw";
import { ruleDeclaration } from "../_token-helpers";

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

describe("B2b running step: gold + shimmer", () => {
  const running = '.chat-step[data-status="running"]';

  it("animates the running step with the shimmer keyframes", () => {
    expect(ruleDeclaration(chatCss, running, "animation")).toContain("chat-shimmer");
    expect(chatCss).toContain("@keyframes chat-shimmer");
  });

  it("marks the running step with a gold dot", () => {
    const dot = `${running}::before`;
    expect(ruleDeclaration(chatCss, dot, "background")).toBe("var(--color-warning-fg)");
    expect(ruleDeclaration(chatCss, dot, "border-radius")).toBe("50%");
  });
});

describe("B2a typing dots", () => {
  it("bounces the dots with a staggered CSS keyframe animation", () => {
    expect(ruleDeclaration(chatCss, ".chat-typing__dot", "animation")).toContain("chat-dot-bounce");
    expect(chatCss).toContain("@keyframes chat-dot-bounce");
    expect(ruleDeclaration(chatCss, ".chat-typing__dot:nth-child(2)", "animation-delay")).toBe("0.15s");
    expect(ruleDeclaration(chatCss, ".chat-typing__dot:nth-child(3)", "animation-delay")).toBe("0.3s");
  });
});

describe("B2c mood card: gradient over semantic tokens", () => {
  it("paints the quote over a primary-token gradient with light text", () => {
    expect(ruleDeclaration(chatCss, ".chat-mood", "color")).toBe("var(--color-primary-fg)");
    expect(ruleDeclaration(chatCss, ".chat-mood", "background")).toContain("var(--color-primary-strong)");
  });

  it("keeps the quote legible with a text-shadow", () => {
    expect(ruleDeclaration(chatCss, ".chat-mood__quote", "text-shadow")).toContain("var(--shadow-3d)");
  });
});

describe("B4 settled footprint: elapsed emphasis over a semantic token", () => {
  it("emphasises the elapsed time with the primary-strong token", () => {
    expect(ruleDeclaration(chatCss, ".chat-settled__elapsed", "color")).toBe("var(--color-primary-strong)");
  });
});
