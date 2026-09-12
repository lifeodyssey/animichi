import { describe, expect, it } from "vitest";
import type { ChatTurnstileDict } from "../../../src/features/chat/i18n";
import { chatDictFor } from "../../../src/features/chat/i18n";
import { LOCALES } from "../../../src/i18n/locales";

const JAPANESE_SCRIPT = /[぀-ヿ一-鿿]/u;
const LATIN_ONLY = /^[\p{ASCII}]+$/u;

/** Wire vocabulary that must never surface in the challenge copy. */
const TECHNICAL_MARKERS = ["turnstile", "cloudflare", "403", "token", "captcha"];

function copyOf(dict: ChatTurnstileDict): readonly string[] {
  return Object.values({ ...dict });
}

describe("AC4 Turnstile copy exists in every locale", () => {
  it.each(LOCALES)("provides non-empty verification state copy for %s", (locale) => {
    expect(copyOf(chatDictFor(locale).turnstile)).not.toContain("");
  });

  it("keeps each locale's retry prompt distinct", () => {
    expect(chatDictFor("ja").turnstile.failed).not.toBe(chatDictFor("en").turnstile.failed);
    expect(chatDictFor("zh").turnstile.failed).not.toBe(chatDictFor("en").turnstile.failed);
    expect(chatDictFor("ja").turnstile.failed).not.toBe(chatDictFor("zh").turnstile.failed);
  });

  it("writes the ja copy in Japanese so a ja user never sees leaked English", () => {
    for (const value of copyOf(chatDictFor("ja").turnstile)) {
      expect(JAPANESE_SCRIPT.test(value)).toBe(true);
    }
  });

  it("writes the en copy in Latin script only", () => {
    for (const value of copyOf(chatDictFor("en").turnstile)) {
      expect(LATIN_ONLY.test(value)).toBe(true);
    }
  });

  it.each(LOCALES)("keeps vendor/wire vocabulary out of the %s copy", (locale) => {
    for (const value of copyOf(chatDictFor(locale).turnstile)) {
      for (const marker of TECHNICAL_MARKERS) {
        expect(value.toLowerCase()).not.toContain(marker);
      }
    }
  });
});
