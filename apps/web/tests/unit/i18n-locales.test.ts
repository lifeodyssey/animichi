import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_LOCALE, LOCALES, LOCALE_LABELS, detectLocale } from "../../src/i18n/locales";

function setLanguages(langs: string[]): void {
  Object.defineProperty(navigator, "languages", { value: langs, configurable: true });
}

afterEach(() => vi.unstubAllGlobals());

describe("locales", () => {
  it("exposes ja/zh/en with the ja default", () => {
    expect(LOCALES).toEqual(["ja", "zh", "en"]);
    expect(DEFAULT_LOCALE).toBe("ja");
    expect(Object.keys(LOCALE_LABELS)).toEqual(["ja", "zh", "en"]);
  });

  it("detects the first supported navigator language", () => {
    setLanguages(["zh-CN", "en"]);
    expect(detectLocale()).toBe("zh");
  });

  it("skips unsupported tags and falls back to the default", () => {
    setLanguages(["fr-FR", "de"]);
    expect(detectLocale()).toBe(DEFAULT_LOCALE);
  });

  it("returns the default when navigator is absent (SSR)", () => {
    vi.stubGlobal("navigator", undefined);
    expect(detectLocale()).toBe(DEFAULT_LOCALE);
  });
});
