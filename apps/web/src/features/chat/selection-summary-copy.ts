import type { Locale } from "../../i18n/locales";

const copy = {
  zh: { selected: "已选 {count} 个地点", review: "查看所选", continue: "继续规划", busy: "整理中…", label: "所选地点" },
  en: { selected: "{count} places selected", review: "Review selection", continue: "Plan trip", busy: "Preparing…", label: "Selected places" },
  ja: { selected: "{count}か所を選択中", review: "選んだ場所を見る", continue: "プランを作る", busy: "整理中…", label: "選んだ場所" },
};

export const selectionSummaryCopy = (locale: Locale) => copy[locale];

export function selectedPlaceCount(locale: Locale, count: number): string {
  if (locale === "en" && count === 1) return "1 place selected";
  return copy[locale].selected.replace("{count}", new Intl.NumberFormat(locale).format(count));
}
