"use client";

import { useLocale, useSetLocale } from "../../lib/i18n-context";
import { LOCALE_LABELS, LOCALES } from "../../lib/i18n";

export default function SharedFooter() {
  const locale = useLocale();
  const setLocale = useSetLocale();

  return (
    <footer className="border-t border-border px-5 py-10 sm:px-8">
      <div className="mx-auto flex max-w-[1200px] items-center justify-between">
        <div className="flex items-baseline gap-2 text-sm text-muted-foreground">
          <span
            className="font-medium font-display"
          >
            聖地巡礼
          </span>
          <span className="opacity-40">·</span>
          <span>seichijunrei</span>
        </div>
        <button
          type="button"
          onClick={() => {
            const idx = LOCALES.indexOf(locale as (typeof LOCALES)[number]);
            setLocale(LOCALES[(idx + 1) % LOCALES.length]);
          }}
          className="text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          {LOCALE_LABELS[locale as keyof typeof LOCALE_LABELS] ?? "EN"}
        </button>
      </div>
    </footer>
  );
}
