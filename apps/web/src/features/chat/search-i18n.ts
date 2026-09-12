/** Copy for the C3a/C3b search result cards, static map (issue #261 S1.4) and
 * the E2 selection tray + recompute footprint (issue #273 S1.7). */
export interface ChatSearchDict {
  readonly select: string;
  readonly browseTitle: string;
  readonly browseHint: string;
  readonly arrange: string;
  readonly arrangePrompt: string;
  readonly previewScene: string;
  readonly closePreview: string;
  readonly sceneUnavailable: string;
  readonly spotCount: string;
  readonly areaFallback: string;
  readonly mapLabel: string;
  readonly backToOverview: string;
  readonly trayMinimum: string;
  readonly traySelected: string;
  readonly trayAction: string;
  readonly trayFailed: string;
  readonly trayRetry: string;
  readonly recompute: string;
}

export const jaSearch: ChatSearchDict = {
  select: "この聖地をえらぶ",
  browseTitle: "気になる場所を見つけよう",
  browseHint: "好きな場面から、ゆっくり見てみよう。",
  arrange: "おまかせで計画する",
  arrangePrompt: "この候補から巡礼を計画してください：{places}。これまで伝えた条件に合わせて、訪れる場所と順番を提案してください。必要な条件が足りなければ聞いてください。",
  previewScene: "場面を大きく見る",
  closePreview: "閉じる",
  sceneUnavailable: "画像を読み込めませんでした。閉じて、もう一度お試しください。",
  spotCount: "{count}件",
  areaFallback: "エリア{n}",
  mapLabel: "聖地マップ",
  backToOverview: "← 全体に戻る",
  trayMinimum: "あと1件選んでください",
  traySelected: "{count}件選択中",
  trayAction: "選んだ場所で計画",
  trayFailed: "組み直せなかったみたい",
  trayRetry: "もう一度ためす",
  recompute: "再計算",
};

export const zhSearch: ChatSearchDict = {
  select: "选择这个圣地",
  browseTitle: "先看看这些地方",
  browseHint: "从感兴趣的场景开始，慢慢看。",
  arrange: "帮我安排",
  arrangePrompt: "请根据这组候选地点帮我安排一次巡礼：{places}。按我们已经聊过的条件挑选合适的地点和顺序，还缺少必要条件就先问我。",
  previewScene: "查看大图",
  closePreview: "关闭预览",
  sceneUnavailable: "图片暂时没加载出来，关闭后可以再试一次。",
  spotCount: "{count} 处",
  areaFallback: "区域{n}",
  mapLabel: "圣地地图",
  backToOverview: "← 返回全部区域",
  trayMinimum: "再选 1 处即可规划",
  traySelected: "已选 {count} 处",
  trayAction: "用这些地点规划",
  trayFailed: "这次没排好路线",
  trayRetry: "再试一次",
  recompute: "重新计算",
};

export const enSearch: ChatSearchDict = {
  select: "Select this spot",
  browseTitle: "Take a look around",
  browseHint: "Start with the scenes that catch your eye.",
  arrange: "Plan it for me",
  arrangePrompt: "Please plan a pilgrimage from these candidates: {places}. Choose suitable places and their order using the preferences we have discussed. Ask me if any essential details are missing.",
  previewScene: "View scene",
  closePreview: "Close preview",
  sceneUnavailable: "The image couldn’t load. Close the preview and try again.",
  spotCount: "{count} spots",
  areaFallback: "Area {n}",
  mapLabel: "Spot map",
  backToOverview: "← Back to all areas",
  trayMinimum: "Choose 1 more spot",
  traySelected: "{count} selected",
  trayAction: "Plan with these places",
  trayFailed: "That rebuild didn't work",
  trayRetry: "Try again",
  recompute: "Recalculated",
};
