"use client";

import { useLocale, useSetLocale } from "../../lib/i18n-context";

const LOCALE_LABELS = { ja: "日本語", zh: "中文", en: "English" } as const;
const LOCALE_CYCLE: Array<"ja" | "zh" | "en"> = ["ja", "zh", "en"];

export default function SharedFooter() {
  const locale = useLocale();
  const setLocale = useSetLocale();

  return (
    <footer className="border-t border-[var(--color-border)] px-5 py-10 sm:px-8">
      <div className="mx-auto flex max-w-[1200px] items-center justify-between">
        <div className="flex items-baseline gap-2 text-[14px] text-[var(--color-muted-fg)]">
          <span
            className="font-medium"
            style={{ fontFamily: "var(--app-font-display)" }}
          >
            聖地巡礼
          </span>
          <span className="opacity-40">·</span>
          <span>seichijunrei</span>
        </div>
        <button
          type="button"
          onClick={() => {
            const idx = LOCALE_CYCLE.indexOf(locale as "ja" | "zh" | "en");
            setLocale(LOCALE_CYCLE[(idx + 1) % LOCALE_CYCLE.length]);
          }}
          className="text-[14px] text-[var(--color-muted-fg)] transition-colors hover:text-[var(--color-fg)]"
        >
          {LOCALE_LABELS[locale as keyof typeof LOCALE_LABELS] ?? "English"}
        </button>
      </div>
    </footer>
  );
}
