/** Copy for the C3a/C3b search result cards, static map (issue #261 S1.4) and
 * the E2 selection tray + recompute footprint (issue #273 S1.7). */
export interface ChatSearchDict {
  readonly select: string;
  readonly spotCount: string;
  readonly areaFallback: string;
  readonly mapLabel: string;
  readonly backToOverview: string;
  readonly trayChanged: string;
  readonly trayMinimum: string;
  readonly traySelected: string;
  readonly trayAction: string;
  readonly trayFailed: string;
  readonly trayRetry: string;
  readonly recompute: string;
}

export const jaSearch: ChatSearchDict = {
  select: "この聖地をえらぶ",
  spotCount: "{count}件",
  areaFallback: "エリア{n}",
  mapLabel: "聖地マップ",
  backToOverview: "← 全体に戻る",
  trayChanged: "スポットの選択が変わりました",
  trayMinimum: "2件以上選んでください",
  traySelected: "{count}件選択中",
  trayAction: "ルートを組み直す",
  trayFailed: "組み直せなかったみたい",
  trayRetry: "もう一度ためす",
  recompute: "再計算",
};

export const zhSearch: ChatSearchDict = {
  select: "选择这个圣地",
  spotCount: "{count} 处",
  areaFallback: "区域{n}",
  mapLabel: "圣地地图",
  backToOverview: "← 返回全部区域",
  trayChanged: "圣地的选择有变化",
  trayMinimum: "请至少选择 2 处",
  traySelected: "已选 {count} 处",
  trayAction: "重新规划路线",
  trayFailed: "这次没排好路线",
  trayRetry: "再试一次",
  recompute: "重新计算",
};

export const enSearch: ChatSearchDict = {
  select: "Select this spot",
  spotCount: "{count} spots",
  areaFallback: "Area {n}",
  mapLabel: "Spot map",
  backToOverview: "← Back to all areas",
  trayChanged: "Your spot selection changed",
  trayMinimum: "Select at least 2 spots",
  traySelected: "{count} selected",
  trayAction: "Rebuild the route",
  trayFailed: "That rebuild didn't work",
  trayRetry: "Try again",
  recompute: "Recalculated",
};
