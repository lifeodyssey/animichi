"use client";

import { useLocale, useSetLocale } from "../../lib/i18n-context";
import { DEFAULT_LOCALE, LOCALE_LABELS, LOCALES } from "../../lib/i18n";
import Image from "next/image";
import { cn } from "../../lib/utils";

const LINK_CLASS = "text-[15px] text-fg/75 transition-colors hover:text-foreground";

export default function SharedFooter() {
  const locale = useLocale();
  const setLocale = useSetLocale();

  return (
    <footer className="border-t border-border bg-background px-5 py-5 sm:px-8">
      <div className="mx-auto flex max-w-[1200px] flex-wrap items-center justify-between gap-x-6 gap-y-2">
        <div className="flex items-center gap-2 text-[15px] text-fg/75">
          <Image src="/images/logo/logo.png" alt="" width={24} height={24} />
          <span className="font-display font-bold text-fg">聖地巡礼</span>
          <span className="opacity-40">·</span>
          <span className="font-mono text-[13px] tracking-wide">animichi</span>
        </div>
        <nav className="flex flex-wrap items-center gap-x-5 gap-y-2">
          {/* Section links (Popular routes / How it works / Save & sync) are hidden
              until those landing sections are rebuilt — their anchors are dead for now. */}
          <a
            href="https://github.com/lifeodyssey/animichi"
            target="_blank"
            rel="noreferrer"
            className={LINK_CLASS}
          >
            GitHub
          </a>
        </nav>
        <button
          type="button"
          onClick={() => {
            const idx = LOCALES.indexOf(locale);
            setLocale(LOCALES[(idx + 1) % LOCALES.length] ?? DEFAULT_LOCALE);
          }}
          className={cn("flex items-center gap-1.5", LINK_CLASS)}
          aria-label="Change language (日本語 / 中文 / English)"
          title="Change language"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
          {LOCALE_LABELS[locale]}
        </button>
      </div>
    </footer>
  );
}
