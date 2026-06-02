"use client";

import { useLocale, useSetLocale } from "../../lib/i18n-context";
import { LOCALE_LABELS, LOCALES } from "../../lib/i18n";
import LeafSprig from "../landing/decor/LeafSprig";

export default function SharedFooter() {
  const locale = useLocale();
  const setLocale = useSetLocale();

  return (
    <footer className="border-t border-border bg-card px-5 py-7 sm:px-8">
      <div className="mx-auto flex max-w-[1200px] items-center justify-between">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <LeafSprig size={20} className="-rotate-12" />
          <span className="font-display font-bold text-fg">聖地巡礼</span>
          <span className="opacity-40">·</span>
          <span className="font-mono text-[12px] tracking-wide">seichijunrei</span>
        </div>
        <button
          type="button"
          onClick={() => {
            const idx = LOCALES.indexOf(locale as (typeof LOCALES)[number]);
            setLocale(LOCALES[(idx + 1) % LOCALES.length]);
          }}
          className="flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
          aria-label="Change language (日本語 / 中文 / English)"
          title="Change language"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
          {LOCALE_LABELS[locale as keyof typeof LOCALE_LABELS] ?? "EN"}
        </button>
      </div>
    </footer>
  );
}
