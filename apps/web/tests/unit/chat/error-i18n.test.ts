import { describe, expect, it } from "vitest";
import { chatDictFor } from "../../../src/features/chat/i18n";
import { LOCALES } from "../../../src/i18n/locales";

const STATES = ["d1", "d2", "d3", "d4", "d5", "d6", "d7", "d8", "d9", "d10", "d11", "d12"] as const;

/** Wire/internal vocabulary that must never surface in user-facing fallback copy. */
const TECHNICAL_MARKERS = [
  "modelretry",
  "output_validator",
  "validation",
  "traceback",
  "exception",
  "http",
  "500",
];

const JAPANESE_SCRIPT = /[぀-ヿ一-鿿]/u;

function errorCopyOf(locale: (typeof LOCALES)[number]): readonly [string, string][] {
  return Object.entries(chatDictFor(locale).errorStates);
}

describe("chat error-state dictionary coverage", () => {
  it.each(LOCALES)("covers every D-state with non-empty %s copy", (locale) => {
    const entries = errorCopyOf(locale);
    for (const [, value] of entries) expect(value.length).toBeGreaterThan(0);
    for (const state of STATES) {
      expect(entries.some(([key]) => key.startsWith(state))).toBe(true);
    }
  });

  it("writes the ja fallback copy in Japanese so a ja user never sees leaked English", () => {
    for (const [key, value] of errorCopyOf("ja")) {
      expect(JAPANESE_SCRIPT.test(value), `ja errorStates.${key} must contain Japanese script`).toBe(true);
    }
  });

  it.each(LOCALES)("writes the %s budget copy without borrowing the D8 expiry copy", (locale) => {
    const states = chatDictFor(locale).errorStates;
    expect(states.d11Message).not.toBe(states.d8Message);
  });

  it("translates the D11 budget copy instead of copying the Japanese string across", () => {
    expect(chatDictFor("zh").errorStates.d11Message).not.toBe(chatDictFor("ja").errorStates.d11Message);
    expect(chatDictFor("en").errorStates.d11Message).not.toBe(chatDictFor("ja").errorStates.d11Message);
    expect(chatDictFor("zh").errorStates.d11Message).not.toBe(chatDictFor("en").errorStates.d11Message);
  });

  it.each(LOCALES)("keeps the %s quota copy distinct from both neighbouring limits", (locale) => {
    const states = chatDictFor(locale).errorStates;
    expect(states.d12Message).not.toBe(states.d11Message);
    expect(states.d12Message).not.toBe(states.d10Message);
    expect(states.d12Message).not.toBe(states.d8Message);
  });

  it("translates the D12 quota copy instead of copying the Japanese string across", () => {
    expect(chatDictFor("zh").errorStates.d12Message).not.toBe(chatDictFor("ja").errorStates.d12Message);
    expect(chatDictFor("en").errorStates.d12Message).not.toBe(chatDictFor("ja").errorStates.d12Message);
    expect(chatDictFor("zh").errorStates.d12Message).not.toBe(chatDictFor("en").errorStates.d12Message);
  });

  it.each(LOCALES)("gives the %s locked composer its own hint, not the ordinary placeholder", (locale) => {
    const dict = chatDictFor(locale);
    expect(dict.errorStates.d12InputHint).not.toBe(dict.inputPlaceholder);
    expect(dict.errorStates.d12InputHint.length).toBeGreaterThan(0);
  });

  it.each(LOCALES)("labels the %s D12 login CTA as a way to continue, not a bare retry", (locale) => {
    const states = chatDictFor(locale).errorStates;
    expect(states.d12Login).not.toBe(states.d4Retry);
    expect(states.d12Login).not.toBe(states.d10Retry);
  });

  it("keeps each locale's D6 apology distinct from the others", () => {
    expect(chatDictFor("ja").errorStates.d6Message).not.toBe(chatDictFor("en").errorStates.d6Message);
    expect(chatDictFor("zh").errorStates.d6Message).not.toBe(chatDictFor("en").errorStates.d6Message);
  });
});

describe("D6 copy never leaks technical details", () => {
  it.each(LOCALES)("keeps ModelRetry/output_validator vocabulary out of every %s string", (locale) => {
    for (const [key, value] of errorCopyOf(locale)) {
      for (const marker of TECHNICAL_MARKERS) {
        expect(value.toLowerCase(), `${locale} errorStates.${key} leaks "${marker}"`).not.toContain(marker);
      }
    }
  });
});
