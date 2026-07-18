import en from "./dictionaries/en.json";
import ja from "./dictionaries/ja.json";
import zh from "./dictionaries/zh.json";
import type { Locale } from "./locales";

export type Dict = typeof ja;

/** All dictionaries are bundled so locale switches are synchronous and SSR-safe. */
export const DICTIONARIES: Record<Locale, Dict> = {
  ja,
  zh: zh satisfies Dict,
  en: en satisfies Dict,
};

export function dictFor(locale: Locale): Dict {
  return DICTIONARIES[locale];
}
