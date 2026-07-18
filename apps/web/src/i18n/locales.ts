export const LOCALES = ["ja", "zh", "en"] as const;

export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "ja";

/** Human-readable locale labels — the single source for every switcher. */
export const LOCALE_LABELS: Record<Locale, string> = {
  ja: "日本語",
  zh: "中文",
  en: "EN",
};

function isLocale(value: string): value is Locale {
  return (LOCALES as readonly string[]).includes(value);
}

function matchLanguage(tag: string): Locale | null {
  const code = tag.toLowerCase().slice(0, 2);
  return isLocale(code) ? code : null;
}

/** SSR-safe: returns DEFAULT_LOCALE off the browser, else the first match. */
export function detectLocale(): Locale {
  if (typeof navigator === "undefined") return DEFAULT_LOCALE;
  for (const tag of navigator.languages) {
    const matched = matchLanguage(tag);
    if (matched) return matched;
  }
  return DEFAULT_LOCALE;
}
