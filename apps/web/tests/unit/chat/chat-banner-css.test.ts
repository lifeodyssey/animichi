import { describe, expect, it } from "vitest";
import chatCss from "../../../src/styles/chat.css?raw";
import { lastRuleDeclaration, ruleDeclaration } from "../stylesheet-probe";

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