import type { Locale } from "../../i18n/locales";
import type { ShioriCompletion, ShioriMode, ShioriStats } from "./compose";

/**
 * Feature-local ja/zh/en copy for the generation screen (S4.2 i18n AC).
 * Kept beside the feature: this card only touches src/features/shiori/.
 */
export interface ShioriLabels {
  modeName: Record<ShioriMode, string>;
  statsLine: (stats: ShioriStats) => string;
  completionLine: (completion: ShioriCompletion) => string;
  retainExif: string;
}

function joinStats(parts: readonly (string | null)[]): string {
  return parts.filter((part) => part !== null).join(" · ");
}

const JA: ShioriLabels = {
  modeName: { planned: "計画しおり", commemorative: "完走記念しおり" },
  statsLine: (stats) =>
    joinStats([`徒歩${String(stats.walkMinutes)}分`, `${String(stats.distanceKm)}km`, stats.timeWindow]),
  completionLine: (c) => `完走 ${String(c.checkedCount)}/${String(c.stopCount)} · ${String(c.ratePercent)}%`,
  retainExif: "写真の位置情報（EXIF）を残す",
};

const ZH: ShioriLabels = {
  modeName: { planned: "行程计划书签", commemorative: "完走纪念书签" },
  statsLine: (stats) =>
    joinStats([`步行${String(stats.walkMinutes)}分`, `${String(stats.distanceKm)}km`, stats.timeWindow]),
  completionLine: (c) => `完走 ${String(c.checkedCount)}/${String(c.stopCount)} · ${String(c.ratePercent)}%`,
  retainExif: "保留照片位置信息（EXIF）",
};

const EN: ShioriLabels = {
  modeName: { planned: "Planned shiori", commemorative: "Commemorative shiori" },
  statsLine: (stats) =>
    joinStats([`${String(stats.walkMinutes)} min walk`, `${String(stats.distanceKm)} km`, stats.timeWindow]),
  completionLine: (c) =>
    `Completed ${String(c.checkedCount)}/${String(c.stopCount)} · ${String(c.ratePercent)}%`,
  retainExif: "Keep photo location data (EXIF)",
};

const LABELS: Record<Locale, ShioriLabels> = { ja: JA, zh: ZH, en: EN };

export function shioriLabels(locale: Locale): ShioriLabels {
  return LABELS[locale];
}
