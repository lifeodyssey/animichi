import { describe, expect, it } from "vitest";
import chatCss from "../../src/styles/chat.css?raw";
import globalsCss from "../../src/styles/globals.css?raw";
import { normalizeHex, parseTokens, ruleDeclaration, tokenValue } from "./_token-helpers";

const tokens = parseTokens(globalsCss);

function resolve(declaration: string | null): string {
  if (declaration === null) throw new Error("missing declaration");
  const name = /var\((--[\w-]+)\)/u.exec(declaration)?.[1];
  return normalizeHex(name === undefined ? declaration : tokenValue(tokens, name));
}

function channel(hex: string, at: number): number {
  const linear = Number.parseInt(hex.slice(at, at + 2), 16) / 255;
  return linear <= 0.04045 ? linear / 12.92 : ((linear + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  return 0.2126 * channel(hex, 1) + 0.7152 * channel(hex, 3) + 0.0722 * channel(hex, 5);
}

function contrast(foreground: string, background: string): number {
  const first = luminance(foreground);
  const second = luminance(background);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

describe("chat error colors meet WCAG AA (>= 4.5:1)", () => {
  it("keeps the error banner text readable on the banner background", () => {
    const background = resolve(ruleDeclaration(chatCss, ".chat-error-banner", "background"));
    const foreground = resolve(ruleDeclaration(chatCss, ".chat-error-banner", "color"));
    expect(contrast(foreground, background)).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps the errored tool-step text readable on the card background", () => {
    const selector = '.chat-step[data-status="error"]';
    const foreground = resolve(ruleDeclaration(chatCss, selector, "color"));
    const card = normalizeHex(tokenValue(tokens, "--color-card"));
    expect(contrast(foreground, card)).toBeGreaterThanOrEqual(4.5);
  });
});
