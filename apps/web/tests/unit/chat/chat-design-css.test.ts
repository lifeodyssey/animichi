import { describe, expect, it } from "vitest";
import chatCss from "../../../src/styles/chat.css?raw";
import { lastRuleDeclaration, ruleDeclaration } from "../_token-helpers";

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
    expect(ruleDeclaration(chatCss, ".chat-chip", "background")).toBe("var(--color-card)");
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

describe("retried step: muted, not alarming", () => {
  const retried = '.chat-step[data-status="retried"]';

  it("mutes the retried step instead of borrowing the error token", () => {
    expect(ruleDeclaration(chatCss, retried, "color")).toBe("var(--color-muted-fg)");
    expect(ruleDeclaration(chatCss, retried, "text-decoration")).toBe("line-through");
  });

  it("keeps the error token reserved for terminal failures", () => {
    const error = '.chat-step[data-status="error"]';
    expect(ruleDeclaration(chatCss, error, "color")).toBe("var(--color-error-strong)");
  });

  it("hides the retried note visually while leaving it in the accessibility tree", () => {
    const note = ".chat-step__note";
    expect(ruleDeclaration(chatCss, note, "clip-path")).toBe("inset(50%)");
    expect(ruleDeclaration(chatCss, note, "position")).toBe("absolute");
    expect(ruleDeclaration(chatCss, note, "width")).toBe("1px");
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

describe("D12 quota banner: an invitation, not a failure", () => {
  const FAMILY = ".chat-session-expired,\n.chat-budget-exhausted,\n.chat-quota-exhausted";

  it("overrides only the tint, with the primary invitation tokens", () => {
    const quota = ".chat-quota-exhausted";
    expect(lastRuleDeclaration(chatCss, quota, "background")).toBe("var(--color-primary-soft)");
    expect(lastRuleDeclaration(chatCss, quota, "border-left-color")).toBe("var(--color-primary-strong)");
    expect(lastRuleDeclaration(chatCss, quota, "padding")).toBeNull();
  });

  it("inherits D8/D11's banner geometry instead of redeclaring it", () => {
    expect(chatCss).toContain(`${FAMILY} {`);
    expect(ruleDeclaration(chatCss, FAMILY, "border-radius")).toBe("14px");
    expect(ruleDeclaration(chatCss, FAMILY, "padding")).toBe("0.625rem 1rem");
  });

  it("shares the actions row and the fallback button chrome, not a second look", () => {
    expect(chatCss).toContain(".chat-budget-exhausted__actions,\n.chat-quota-exhausted__actions {");
    expect(chatCss).toContain(".chat-budget-exhausted__login,\n.chat-quota-exhausted__login {");
  });

  it("keeps the warning tint on the two banners where something did fail", () => {
    expect(ruleDeclaration(chatCss, FAMILY, "border-left")).toBe("4px solid var(--color-warning-fg)");
    expect(ruleDeclaration(chatCss, FAMILY, "background")).toBe("var(--color-muted)");
  });
});

describe("B4 settled footprint: elapsed emphasis over a semantic token", () => {
  it("emphasises the elapsed time with the primary-strong token", () => {
    expect(ruleDeclaration(chatCss, ".chat-settled__elapsed", "color")).toBe("var(--color-primary-strong)");
  });
});

describe("C3b drill-back chip (issue #437)", () => {
  it("carries layout only, so the cream chip tokens stay the single source", () => {
    expect(ruleDeclaration(chatCss, ".chat-drill__back", "align-self")).toBe("flex-start");
    expect(ruleDeclaration(chatCss, ".chat-drill__back", "background")).toBeNull();
    expect(ruleDeclaration(chatCss, ".chat-drill__back", "color")).toBeNull();
  });
});

describe("S1.9 Turnstile dock slot (issue #447)", () => {
  it("paints the gate with the dock's own surface token, never a raw color", () => {
    expect(ruleDeclaration(chatCss, ".turnstile-gate", "background")).toBe("var(--color-card)");
    expect(ruleDeclaration(chatCss, ".turnstile-gate", "max-width")).toBe("48rem");
  });

  it("costs no vertical rhythm until the widget actually renders something", () => {
    expect(ruleDeclaration(chatCss, ".turnstile-gate", "padding-block")).toBeNull();
    expect(ruleDeclaration(chatCss, ".turnstile-gate .cf-turnstile:not(:empty)", "margin-block")).toBe("0.75rem");
  });

  it("styles the retry with the shared 3D press affordance and semantic tokens", () => {
    expect(ruleDeclaration(chatCss, ".turnstile-gate__retry", "background")).toBe("var(--color-primary)");
    expect(ruleDeclaration(chatCss, ".turnstile-gate__retry", "box-shadow")).toBe("0 3px 0 var(--shadow-3d)");
    expect(ruleDeclaration(chatCss, ".turnstile-gate__error", "color")).toBe("var(--color-error-strong)");
  });
});
