export const COLORS = {
  teal: "#19c8b9",
  gold: "#f0b429",
  brown: "#8a6f4d",
  cream: "#faf6ee",
  ink: "#2f2a21",
  line: "#3a3228"
} as const;

export const TILE_URL = "/tiles/uji-kyoto.pmtiles";
export const BAD_TILE_URL = "/tiles/missing-uji.pmtiles";
export const WORKER_TILE_URL = "http://127.0.0.1:8787/tiles/{z}/{x}/{y}.mvt";

export const UJI_CENTER: LngLat = [135.811, 34.8937];
export const TOKYO_CENTER: LngLat = [139.77, 35.68];

export const STATIC_BOUNDS = {
  west: 135.8038,
  south: 34.8892,
  east: 135.821,
  north: 34.897
} as const;

export const STATIC_SIZE = { width: 1000, height: 620 } as const;

export type LngLat = readonly [number, number];

export type SpotKind = "start" | "normal" | "highlight";

export interface Spot {
  readonly id: string;
  readonly label: string;
  readonly coord: LngLat;
  readonly kind: SpotKind;
}

export const SPOTS: readonly Spot[] = [
  {
    id: "ujibashi",
    label: "宇治橋",
    coord: [135.8077, 34.893],
    kind: "start"
  },
  {
    id: "omotesando",
    label: "平等院表参道",
    coord: [135.8064, 34.8912],
    kind: "normal"
  },
  {
    id: "ujijinja",
    label: "宇治神社",
    coord: [135.8118, 34.8918],
    kind: "normal"
  },
  {
    id: "daikichiyama",
    label: "大吉山展望台",
    coord: [135.8189, 34.8951],
    kind: "highlight"
  },
  {
    id: "keihan-uji",
    label: "京阪宇治駅",
    coord: [135.8079, 34.8945],
    kind: "normal"
  }
] as const;
