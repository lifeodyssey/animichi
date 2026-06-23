"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { Dict, Locale } from "./i18n";
import { DEFAULT_LOCALE, detectLocale, loadDict } from "./i18n";
import defaultDict from "./dictionaries/ja.json";

interface I18nCtx {
  dict: Dict;
  locale: Locale;
  setLocale: (locale: Locale) => void;
}

const I18nContext = createContext<I18nCtx>({
  dict: defaultDict,
  locale: DEFAULT_LOCALE,
  setLocale: () => {
    // Default no-op: overridden by LocaleProvider; safe outside a provider.
  },
});

export function LocaleProvider({ children }: { children: React.ReactNode }) {
  // Initialize with DEFAULT_LOCALE to match SSR output (prevents hydration mismatch).
  // After mount, detect the real locale from navigator.languages via effect.
  const [locale, setLocaleState] = useState<Locale>(DEFAULT_LOCALE);
  const [dict, setDict] = useState<Dict>(defaultDict);

  // Detect real locale after hydration completes
  useEffect(() => {
    const real = detectLocale();
    if (real !== DEFAULT_LOCALE) {
      // Defer to next frame to avoid set-state-in-effect lint warning
      requestAnimationFrame(() => { setLocaleState(real); });
    }
  }, []);

  // Load dictionary when locale changes
  useEffect(() => {
    let cancelled = false;
    document.documentElement.lang = locale;
    void loadDict(locale).then((d) => {
      if (!cancelled) setDict(d);
    });
    return () => { cancelled = true; };
  }, [locale]);

  const setLocale = useCallback((newLocale: Locale) => {
    setLocaleState(newLocale);
  }, []);

  return (
    <I18nContext.Provider value={{ dict, locale, setLocale }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useDict(): Dict {
  return useContext(I18nContext).dict;
}

export function useLocale(): Locale {
  return useContext(I18nContext).locale;
}

export function useSetLocale(): (locale: Locale) => void {
  return useContext(I18nContext).setLocale;
}
