import { describe, expect, it } from "vitest";
import { DEFAULT_LOCALE } from "../../src/i18n/locales";
import { langFromMatches } from "../../src/routes/__root";

describe("langFromMatches", () => {
  it("falls back to the default locale when no match carries one", () => {
    expect(langFromMatches([])).toBe(DEFAULT_LOCALE);
    expect(langFromMatches([{ loaderData: undefined }])).toBe("ja");
  });

  it("uses the locale from the deepest locale-bearing match", () => {
    const matches = [
      { loaderData: { locale: "zh" } },
      { loaderData: { locale: "en" } },
    ];
    expect(langFromMatches(matches)).toBe("en");
  });

  it("ignores loader data without a valid locale", () => {
    const matches = [
      { loaderData: { locale: "en" } },
      { loaderData: { locale: "xx" } },
      { loaderData: { points: 3 } },
    ];
    expect(langFromMatches(matches)).toBe("en");
  });
});
