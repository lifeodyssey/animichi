import { describe, expect, it } from "vitest";
import { chatDictFor } from "../../../src/features/chat/i18n";
import { LOCALES } from "../../../src/i18n/locales";

/** AC12: clarification copy, C2t chips, and photo-search prompts in ja/zh/en. */

function flatten(dict: Record<string, string>): string[] {
  return Object.values(dict);
}

describe("clarify/departure/location/photo copy (AC12)", () => {
  it.each(LOCALES)("locale %s has every string filled in", (locale) => {
    const dict = chatDictFor(locale);
    const values = [
      ...flatten({ ...dict.clarify }),
      ...flatten({ ...dict.departure }),
      ...flatten({ ...dict.location }),
      ...flatten({ ...dict.photo }),
    ];
    expect(values).toHaveLength(4 + 6 + 5 + 9);
    expect(values.every((value) => value.trim().length > 0)).toBe(true);
  });

  it("locales are actually translated, not copied", () => {
    const escapeHatches = LOCALES.map((locale) => chatDictFor(locale).clarify.escapeHatch);
    expect(new Set(escapeHatches).size).toBe(LOCALES.length);
    const uploads = LOCALES.map((locale) => chatDictFor(locale).photo.upload);
    expect(new Set(uploads).size).toBe(LOCALES.length);
  });

  it("keeps the D4 transparency note about platform processing", () => {
    expect(chatDictFor("ja").photo.processedNote).toBe("画像は Animichi の枠で処理");
  });

  it("offers four distinct departure chips per locale", () => {
    const chips = LOCALES.map((locale) => {
      const departure = chatDictFor(locale).departure;
      return new Set([departure.stationChip, departure.hereChip, departure.manualChip, departure.autoChip]).size;
    });
    expect(chips).toEqual([4, 4, 4]);
  });
});
