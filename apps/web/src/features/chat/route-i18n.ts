import type { Pacing } from "@seichijunrei/contract";

/** Copy for the S1.5 route card: pacing pill, capsules, CTA row (issue #271). */
export interface ChatRouteDict {
  readonly pacing: Readonly<Record<Pacing, string>>;
  readonly walkCapsule: string;
  readonly transitCapsule: string;
  readonly highlight: string;
  readonly routePill: string;
  readonly walkCta: string;
  readonly openMaps: string;
  readonly timelineLabel: string;
  readonly mapLabel: string;
}

export const jaRoute: ChatRouteDict = {
  pacing: { chill: "ゆったり", normal: "適中", packed: "緊張" },
  walkCapsule: "徒歩{min}分",
  transitCapsule: "移動{min}分",
  highlight: "名場面スポット",
  routePill: "ルート",
  walkCta: "歩きモード(準備中)",
  openMaps: "Googleマップで開く",
  timelineLabel: "ルートのタイムライン",
  mapLabel: "ルートマップ",
};

export const zhRoute: ChatRouteDict = {
  pacing: { chill: "悠闲", normal: "适中", packed: "紧凑" },
  walkCapsule: "步行{min}分钟",
  transitCapsule: "乘车{min}分钟",
  highlight: "名场面地点",
  routePill: "路线",
  walkCta: "步行模式(即将上线)",
  openMaps: "在 Google 地图打开",
  timelineLabel: "路线时间轴",
  mapLabel: "路线地图",
};

export const enRoute: ChatRouteDict = {
  pacing: { chill: "Chill", normal: "Balanced", packed: "Packed" },
  walkCapsule: "Walk {min} min",
  transitCapsule: "Transit {min} min",
  highlight: "Highlight scene",
  routePill: "Route",
  walkCta: "Walk mode (coming soon)",
  openMaps: "Open in Google Maps",
  timelineLabel: "Route timeline",
  mapLabel: "Route map",
};
