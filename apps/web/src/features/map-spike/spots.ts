export type LngLat = readonly [number, number];

export type SpotKind = "start" | "normal" | "highlight";

export interface Spot {
  readonly id: string;
  readonly label: string;
  readonly coord: LngLat;
  readonly kind: SpotKind;
}

export interface Bounds {
  readonly west: number;
  readonly south: number;
  readonly east: number;
  readonly north: number;
}

export interface Size {
  readonly width: number;
  readonly height: number;
}

// Uji (Kansai) — the "響け！ユーフォニアム" pilgrimage cluster used across the spike.
export const UJI_CENTER: LngLat = [135.811, 34.8937];
export const UJI_ZOOM = 13.9;

export const STATIC_BOUNDS: Bounds = {
  west: 135.8038,
  south: 34.8892,
  east: 135.821,
  north: 34.897,
};

export const STATIC_SIZE: Size = { width: 1000, height: 620 };

// Same-origin tile endpoints served by the edge Worker from the R2 `seichijunrei-assets` bucket.
export const TILE_PMTILES_URL = "/tiles/uji-kyoto.pmtiles";
export const TILE_ZXY_URL = "/tiles/{z}/{x}/{y}.mvt";

export const SPOTS: readonly Spot[] = [
  { id: "ujibashi", label: "宇治橋", coord: [135.8077, 34.893], kind: "start" },
  { id: "omotesando", label: "平等院表参道", coord: [135.8064, 34.8912], kind: "normal" },
  { id: "ujijinja", label: "宇治神社", coord: [135.8118, 34.8918], kind: "normal" },
  { id: "daikichiyama", label: "大吉山展望台", coord: [135.8189, 34.8951], kind: "highlight" },
  { id: "keihan-uji", label: "京阪宇治駅", coord: [135.8079, 34.8945], kind: "normal" },
] as const;
