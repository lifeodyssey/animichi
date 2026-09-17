import { describe, expect, it } from "vitest";
import { chatDictFor } from "../../../src/features/chat/i18n";
import { LOCALES } from "../../../src/i18n/locales";

/** AC12: clarification copy, C2t chips, and the C4 location prompt in ja/zh/en.
 * The photo-search prompts half left with the surface in #1604. */

function flatten(dict: Record<string, string>): string[] {
  return Object.values(dict);
}

describe("clarify/departure/location copy (AC12)", () => {
  it.each(LOCALES)("locale %s has every string filled in", (locale) => {
    const dict = chatDictFor(locale);
    const values = [
      ...flatten({ ...dict.clarify }),
      ...flatten({ ...dict.departure }),
      ...flatten({ ...dict.location }),
    ];
    expect(values).toHaveLength(21 + 6 + 9);
    expect(values.every((value) => value.trim().length > 0)).toBe(true);
  });

  it("locales are actually translated, not copied", () => {
    const escapeHatches = LOCALES.map((locale) => chatDictFor(locale).clarify.escapeHatch);
    expect(new Set(escapeHatches).size).toBe(LOCALES.length);
    const locationPrompts = LOCALES.map((locale) => chatDictFor(locale).location.allow);
    expect(new Set(locationPrompts).size).toBe(LOCALES.length);
  });

  it("offers four distinct departure chips per locale", () => {
    const chips = LOCALES.map((locale) => {
      const departure = chatDictFor(locale).departure;
      return new Set([departure.stationChip, departure.hereChip, departure.manualChip, departure.autoChip]).size;
    });
    expect(chips).toEqual([4, 4, 4]);
  });
});
