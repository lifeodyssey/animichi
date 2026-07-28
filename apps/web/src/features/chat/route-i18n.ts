import type { Pacing } from "@seichijunrei/contract";

/** Copy for the S1.5 route card: pacing pill, capsules, CTA row (issue #271). */
export interface ChatRouteDict {
  readonly pacing: Readonly<Record<Pacing, string>>;
  /** `{spots}` spots and `{min}` total walking minutes. */
  readonly stats: string;
  readonly walkCapsule: string;
  readonly transitCapsule: string;
  readonly highlight: string;
  readonly routePill: string;
  readonly walkCta: string;
  readonly openMaps: string;
  /** P5 save CTA copy (issue #273 S1.7). */
  readonly saveCta: string;
  /** `{title}` resolved work, `{count}` stop count — the derived route title. */
  readonly saveTitle: string;
  /** Localized stand-in when the stream carried no resolved work title. */
  readonly saveUntitled: string;
  readonly saved: string;
  readonly saveError: string;
  readonly saveRetry: string;
  readonly timelineLabel: string;
  readonly mapLabel: string;
}

export const jaRoute: ChatRouteDict = {
  pacing: { chill: "ゆったり", normal: "適中", packed: "緊張" },
  stats: "{spots}スポット・徒歩{min}分",
  walkCapsule: "徒歩{min}分",
  transitCapsule: "移動{min}分",
  highlight: "名場面スポット",
  routePill: "ルート",
  walkCta: "歩きモード(準備中)",
  openMaps: "Googleマップで開く",
  saveCta: "保存する",
  saveTitle: "{title}・{count}スポットの聖地巡礼",
  saveUntitled: "この作品",
  saved: "保存したよ",
  saveError: "保存できなかった…",
  saveRetry: "もう一度保存",
  timelineLabel: "ルートのタイムライン",
  mapLabel: "ルートマップ",
};

export const zhRoute: ChatRouteDict = {
  pacing: { chill: "悠闲", normal: "适中", packed: "紧凑" },
  stats: "{spots} 个地点・步行 {min} 分钟",
  walkCapsule: "步行{min}分钟",
  transitCapsule: "乘车{min}分钟",
  highlight: "名场面地点",
  routePill: "路线",
  walkCta: "步行模式(即将上线)",
  openMaps: "在 Google 地图打开",
  saveCta: "保存路线",
  saveTitle: "{title}・{count} 个地点的圣地巡礼",
  saveUntitled: "这部作品",
  saved: "已经保存好了",
  saveError: "没能保存…",
  saveRetry: "再保存一次",
  timelineLabel: "路线时间轴",
  mapLabel: "路线地图",
};

export const enRoute: ChatRouteDict = {
  pacing: { chill: "Chill", normal: "Balanced", packed: "Packed" },
  stats: "{spots} spots · {min} min walking",
  walkCapsule: "Walk {min} min",
  transitCapsule: "Transit {min} min",
  highlight: "Highlight scene",
  routePill: "Route",
  walkCta: "Walk mode (coming soon)",
  openMaps: "Open in Google Maps",
  saveCta: "Save this route",
  saveTitle: "{title} · a {count}-spot pilgrimage",
  saveUntitled: "this work",
  saved: "Saved it",
  saveError: "That didn't save…",
  saveRetry: "Save again",
  timelineLabel: "Route timeline",
  mapLabel: "Route map",
};
