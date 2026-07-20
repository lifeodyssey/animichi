import type { Locale } from "../../i18n/locales";

/**
 * Trilingual copy for the route detail shell, local to the feature (the shared
 * dictionary JSONs are a parallel-card hotspot; keeping copy here stays
 * conflict-free, matching the anime feature's convention).
 */
export interface RouteDetailCopy {
  readonly goldBar: string;
  readonly completedBadge: (done: number, total: number) => string;
  readonly mapPlaceholder: string;
  readonly mapExpand: string;
  readonly mapCollapse: string;
  readonly progressAria: string;
  readonly pinVisited: string;
  readonly pinCurrent: string;
  readonly pinUnvisited: string;
  readonly timetablePlaceholder: string;
  readonly emptyTitle: string;
  readonly emptyBody: string;
  readonly loadingLabel: string;
  readonly errorTitle: string;
  readonly errorBody: string;
  readonly errorRetry: string;
  readonly errorHome: string;
}

const ja: RouteDetailCopy = {
  goldBar: "きょうは巡礼日!→歩くモードへ",
  completedBadge: (done, total) => `完走 ${String(done)}/${String(total)} ✓`,
  mapPlaceholder: "地図を準備しています",
  mapExpand: "地図を広げる",
  mapCollapse: "地図をたたむ",
  progressAria: "巡礼の進捗",
  pinVisited: "訪問済み",
  pinCurrent: "現在地",
  pinUnvisited: "未訪問",
  timetablePlaceholder: "スケジュールを準備しています",
  emptyTitle: "このルートにはまだ地点がありません",
  emptyBody: "チャットからスポットを追加すると、ここにルートが表示されます。",
  loadingLabel: "読み込み中",
  errorTitle: "エラーが発生しました",
  errorBody: "ルート情報を読み込めませんでした。もう一度お試しください。",
  errorRetry: "もう一度試す",
  errorHome: "ホームに戻る",
};

const zh: RouteDetailCopy = {
  goldBar: "今天是巡礼日!→前往步行模式",
  completedBadge: (done, total) => `完走 ${String(done)}/${String(total)} ✓`,
  mapPlaceholder: "地图准备中",
  mapExpand: "展开地图",
  mapCollapse: "收起地图",
  progressAria: "巡礼进度",
  pinVisited: "已访问",
  pinCurrent: "当前",
  pinUnvisited: "未访问",
  timetablePlaceholder: "行程准备中",
  emptyTitle: "该路线暂无地点",
  emptyBody: "从对话中加入圣地后,这里会显示你的路线。",
  loadingLabel: "加载中",
  errorTitle: "出错了",
  errorBody: "暂时无法加载该路线,请重试。",
  errorRetry: "重试",
  errorHome: "返回首页",
};

const en: RouteDetailCopy = {
  goldBar: "Today is a pilgrimage day! → to Walk Mode",
  completedBadge: (done, total) => `Complete ${String(done)}/${String(total)} ✓`,
  mapPlaceholder: "Preparing the map",
  mapExpand: "Expand map",
  mapCollapse: "Collapse map",
  progressAria: "Pilgrimage progress",
  pinVisited: "Visited",
  pinCurrent: "Current",
  pinUnvisited: "Not visited",
  timetablePlaceholder: "Preparing the schedule",
  emptyTitle: "This route has no spots yet",
  emptyBody: "Add spots from chat and your route will appear here.",
  loadingLabel: "Loading",
  errorTitle: "Something went wrong",
  errorBody: "We could not load this route right now. Please try again.",
  errorRetry: "Try again",
  errorHome: "Return home",
};

const COPY: Record<Locale, RouteDetailCopy> = { ja, zh, en };

export function routeDetailCopyFor(locale: Locale): RouteDetailCopy {
  return COPY[locale];
}
