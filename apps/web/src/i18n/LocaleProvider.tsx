import type { ReactNode } from "react";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { type Dict, dictFor } from "./dictionaries";
import { DEFAULT_LOCALE, detectLocale, type Locale } from "./locales";

interface I18nValue {
  dict: Dict;
  locale: Locale;
  setLocale: (locale: Locale) => void;
}

const I18nContext = createContext<I18nValue | null>(null);

/** Applies `<html lang>` after mount so SSR output stays on DEFAULT_LOCALE. */
function useHtmlLang(locale: Locale): void {
  useEffect(() => { document.documentElement.lang = locale; }, [locale]);
}

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState<Locale>(DEFAULT_LOCALE);
  useEffect(() => { setLocale(detectLocale()); }, []);
  useHtmlLang(locale);
  const value = useMemo<I18nValue>(() => ({ dict: dictFor(locale), locale, setLocale }), [locale]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

function useI18n(): I18nValue {
  const value = useContext(I18nContext);
  if (!value) throw new Error("useI18n must be used within a LocaleProvider");
  return value;
}

export function useDict(): Dict {
  return useI18n().dict;
}

export function useLocale(): Locale {
  return useI18n().locale;
}

export function useSetLocale(): (locale: Locale) => void {
  return useI18n().setLocale;
}
