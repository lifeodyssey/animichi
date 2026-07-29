import type { Locale } from "../../i18n/locales";

/**
 * Trilingual copy for the anime page, local to the feature (the shared
 * dictionary JSONs are a parallel-card hotspot; this keeps S5.1 conflict-free).
 * Fact sentences are self-contained and independently citable (SD-27 GEO AC).
 */
export interface AnimeCopy {
  readonly h1: string;
  readonly heroSubtitle: (id: string) => string;
  readonly factsHeading: string;
  readonly scenesHeading: string;
  readonly areasHeading: string;
  readonly empty: string;
  readonly spotsLabel: string;
  readonly citiesLabel: string;
  readonly durationLabel: string;
  readonly routesLabel: string;
  readonly sourceLabel: string;
  readonly spotCountFact: (n: number) => string;
  readonly topCitiesFact: (cities: string) => string;
  readonly durationFact: (minutes: number) => string;
  readonly routesFact: (n: number) => string;
  readonly attribution: string;
  readonly shotCountFact: (n: number) => string;
  readonly spotUnit: (n: number) => string;
  readonly errorTitle: string;
  readonly errorBody: string;
  readonly errorRetry: string;
  readonly errorHome: string;
}

function hoursOf(minutes: number): number {
  return Math.max(1, Math.round(minutes / 60));
}

const ja: AnimeCopy = {
  h1: "聖地巡礼ガイド",
  heroSubtitle: (id) => `作品ID ${id} の聖地スポットと名場面をまとめています。`,
  factsHeading: "作品ファクト",
  scenesHeading: "名場面ランキング",
  areasHeading: "エリア別スポット",
  empty: "この作品はまだ聖地情報がありません",
  spotsLabel: "聖地スポット数",
  citiesLabel: "主なエリア",
  durationLabel: "所要時間の目安",
  routesLabel: "モデルコース",
  sourceLabel: "データ出典",
  spotCountFact: (n) => `この作品の聖地スポットは全${String(n)}件が登録されています。`,
  topCitiesFact: (cities) => `この作品の聖地が多いエリアは${cities}です。`,
  durationFact: (minutes) => `モデルコースの所要時間は約${String(hoursOf(minutes))}時間が目安です。`,
  routesFact: (n) => `エリア別のモデルコースが${String(n)}件用意されています。`,
  attribution: "この作品の聖地データの出典はAnitabi（CC BY-NC-SA）です。",
  shotCountFact: (n) => `カット数 ${String(n)}`,
  spotUnit: (n) => `${String(n)}件`,
  errorTitle: "エラーが発生しました",
  errorBody: "作品情報を読み込めませんでした。もう一度お試しください。",
  errorRetry: "もう一度試す",
  errorHome: "ホームに戻る",
};

const zh: AnimeCopy = {
  h1: "圣地巡礼指南",
  heroSubtitle: (id) => `汇总作品ID ${id} 的圣地打卡点与名场面。`,
  factsHeading: "作品事实",
  scenesHeading: "名场面排行",
  areasHeading: "按地区分布",
  empty: "该作品暂无圣地巡礼信息",
  spotsLabel: "圣地数量",
  citiesLabel: "主要地区",
  durationLabel: "预计耗时",
  routesLabel: "示例路线",
  sourceLabel: "数据来源",
  spotCountFact: (n) => `该作品共登记了${String(n)}处圣地巡礼地点。`,
  topCitiesFact: (cities) => `该作品圣地最集中的地区是${cities}。`,
  durationFact: (minutes) => `示例路线预计耗时约${String(hoursOf(minutes))}小时。`,
  routesFact: (n) => `按地区提供了${String(n)}条示例路线。`,
  attribution: "该作品的圣地数据来源为Anitabi（CC BY-NC-SA）。",
  shotCountFact: (n) => `镜头数 ${String(n)}`,
  spotUnit: (n) => `${String(n)}处`,
  errorTitle: "出错了",
  errorBody: "暂时无法加载该作品，请重试。",
  errorRetry: "重试",
  errorHome: "返回首页",
};

const en: AnimeCopy = {
  h1: "Anime Pilgrimage Guide",
  heroSubtitle: (id) => `Real-life spots and famous scenes for title ID ${id}.`,
  factsHeading: "Fact Summary",
  scenesHeading: "Famous Scenes",
  areasHeading: "Spots by Area",
  empty: "No pilgrimage spots are recorded for this title yet",
  spotsLabel: "Total spots",
  citiesLabel: "Top areas",
  durationLabel: "Suggested duration",
  routesLabel: "Sample routes",
  sourceLabel: "Data source",
  spotCountFact: (n) => `This title has ${String(n)} pilgrimage spots on record.`,
  topCitiesFact: (cities) => `Most of this title's spots are in ${cities}.`,
  durationFact: (minutes) => `A sample route takes about ${String(hoursOf(minutes))} hour(s).`,
  routesFact: (n) => `${String(n)} per-area sample routes are available.`,
  attribution: "Spot data for this title is sourced from Anitabi (CC BY-NC-SA).",
  shotCountFact: (n) => `${String(n)} shots`,
  spotUnit: (n) => `${String(n)} spots`,
  errorTitle: "Something went wrong",
  errorBody: "We could not load this title right now. Please try again.",
  errorRetry: "Try again",
  errorHome: "Return home",
};

const COPY: Record<Locale, AnimeCopy> = { ja, zh, en };

export function animeCopyFor(locale: Locale): AnimeCopy {
  return COPY[locale];
}
