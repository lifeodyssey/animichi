import { describe, expect, it } from "vitest";
import { LOCALES } from "../../../src/i18n/locales";
import { chatDictFor } from "../../../src/features/chat/i18n";

describe("chatDictFor", () => {
  it.each(LOCALES)("provides a full %s dictionary with 3 example chips", (locale) => {
    const dict = chatDictFor(locale);
    expect(dict.greeting.length).toBeGreaterThan(0);
    expect(dict.chips).toHaveLength(3);
    expect(dict.inputPlaceholder.length).toBeGreaterThan(0);
    expect(dict.errorBanner.length).toBeGreaterThan(0);
    expect(dict.retry.length).toBeGreaterThan(0);
  });

  it("self-references the fox persona as Animichi in every locale", () => {
    expect(chatDictFor("ja").greeting).toContain("アニミチ");
    expect(chatDictFor("zh").greeting).toContain("Animichi");
    expect(chatDictFor("en").greeting).toContain("Animichi");
  });

  it("keeps locale dictionaries distinct", () => {
    expect(chatDictFor("ja").greeting).not.toBe(chatDictFor("en").greeting);
    expect(chatDictFor("zh").greeting).not.toBe(chatDictFor("en").greeting);
  });
});
