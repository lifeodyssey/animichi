import type { Locale } from "../../i18n/locales";

/**
 * Trilingual copy for the bubble map, local to the feature (the shared
 * dictionary JSONs are a parallel-card hotspot; feature-local copy keeps
 * S5.2 conflict-free, mirroring the S5.1 anime-page convention).
 */
export interface BubbleMapCopy {
  readonly heading: string;
  readonly empty: string;
  readonly spotUnit: (n: number) => string;
  readonly sheetTitle: (region: string) => string;
  readonly sheetEmpty: string;
  readonly noPhoto: string;
  readonly shotCount: (n: number) => string;
  readonly close: string;
}

const ja: BubbleMapCopy = {
  heading: "エリア別バブルマップ",
  empty: "地図に表示できる聖地エリアがまだありません",
  spotUnit: (n) => `${String(n)}件`,
  sheetTitle: (region) => `${region} の機位`,
  sheetEmpty: "このエリアの機位情報はまだありません",
  noPhoto: "写真はまだありません",
  shotCount: (n) => `カット数 ${String(n)}`,
  close: "閉じる",
};

const zh: BubbleMapCopy = {
  heading: "按地区分布气泡地图",
  empty: "暂无可在地图上展示的圣地地区",
  spotUnit: (n) => `${String(n)}处`,
  sheetTitle: (region) => `${region} 的机位`,
  sheetEmpty: "该地区暂无机位信息",
  noPhoto: "暂无照片",
  shotCount: (n) => `镜头数 ${String(n)}`,
  close: "关闭",
};

const en: BubbleMapCopy = {
  heading: "Bubble map by area",
  empty: "No pilgrimage areas to plot on the map yet",
  spotUnit: (n) => `${String(n)} spots`,
  sheetTitle: (region) => `Shot angles in ${region}`,
  sheetEmpty: "No shot-angle spots recorded for this area yet",
  noPhoto: "No photo yet",
  shotCount: (n) => `${String(n)} shots`,
  close: "Close",
};

const COPY: Record<Locale, BubbleMapCopy> = { ja, zh, en };

export function bubbleMapCopyFor(locale: Locale): BubbleMapCopy {
  return COPY[locale];
}
