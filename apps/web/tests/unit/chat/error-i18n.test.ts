import { describe, expect, it } from "vitest";
import { chatDictFor } from "../../../src/features/chat/i18n";
import { LOCALES } from "../../../src/i18n/locales";

const STATES = ["d1", "d2", "d3", "d4", "d5", "d6", "d7", "d8", "d9"] as const;

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
  it.each(LOCALES)("covers all nine D-states with non-empty %s copy", (locale) => {
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
