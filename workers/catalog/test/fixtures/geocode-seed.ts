import type { GeocodeHit } from "../../src/lib/geocode";

type SeedLocation = Omit<GeocodeHit, "priority" | "exact">;

export const SEED_LOCATIONS: Readonly<Record<string, SeedLocation>> = {
  "seed:uji": { id: "seed:uji", name: "宇治", kind: "city", latitude: 34.8843, longitude: 135.7997, source: "seed", pref: "京都府" },
  "seed:kyoto": { id: "seed:kyoto", name: "京都", kind: "city", latitude: 35.0116, longitude: 135.7681, source: "seed", pref: "京都府" },
  "seed:kyoto-station": { id: "seed:kyoto-station", name: "京都駅", kind: "station", latitude: 34.9858, longitude: 135.7588, source: "seed", pref: "京都府" },
  "seed:tokyo-station": { id: "seed:tokyo-station", name: "東京駅", kind: "station", latitude: 35.6812, longitude: 139.7671, source: "seed", pref: "東京都" },
  "seed:tokyo": { id: "seed:tokyo", name: "東京", kind: "city", latitude: 35.6762, longitude: 139.6503, source: "seed", pref: "東京都" },
  "seed:shinjuku": { id: "seed:shinjuku", name: "新宿", kind: "ward", latitude: 35.6896, longitude: 139.7006, source: "seed", pref: "東京都" },
  "seed:akihabara": { id: "seed:akihabara", name: "秋葉原", kind: "landmark", latitude: 35.7023, longitude: 139.7745, source: "seed", pref: "東京都" },
  "seed:takayama": { id: "seed:takayama", name: "飛騨高山", kind: "city", latitude: 36.1461, longitude: 137.2522, source: "seed", pref: "岐阜県" },
  "seed:kamakura": { id: "seed:kamakura", name: "鎌倉", kind: "city", latitude: 35.3192, longitude: 139.5467, source: "seed", pref: "神奈川県" },
  "seed:osaka": { id: "seed:osaka", name: "大阪", kind: "city", latitude: 34.6937, longitude: 135.5023, source: "seed", pref: "大阪府" },
  "seed:shibuya": { id: "seed:shibuya", name: "渋谷", kind: "ward", latitude: 35.6580, longitude: 139.7016, source: "seed", pref: "東京都" },
  "seed:ikebukuro": { id: "seed:ikebukuro", name: "池袋", kind: "landmark", latitude: 35.7295, longitude: 139.7109, source: "seed", pref: "東京都" },
  "seed:yokohama": { id: "seed:yokohama", name: "横浜", kind: "city", latitude: 35.4437, longitude: 139.6380, source: "seed", pref: "神奈川県" },
  "seed:nara": { id: "seed:nara", name: "奈良", kind: "city", latitude: 34.6851, longitude: 135.8048, source: "seed", pref: "奈良県" },
  "seed:hiroshima": { id: "seed:hiroshima", name: "広島", kind: "city", latitude: 34.3853, longitude: 132.4553, source: "seed", pref: "広島県" },
  "seed:hiroshima-station": { id: "seed:hiroshima-station", name: "広島駅", kind: "station", latitude: 34.3976, longitude: 132.4753, source: "seed", pref: "広島県" },
  "seed:nagoya": { id: "seed:nagoya", name: "名古屋", kind: "city", latitude: 35.1815, longitude: 136.9066, source: "seed", pref: "愛知県" },
  "seed:uji-station": { id: "seed:uji-station", name: "宇治駅", kind: "station", latitude: 34.8891, longitude: 135.8008, source: "seed", pref: "京都府" },
  "seed:rokujizo": { id: "seed:rokujizo", name: "六地蔵", kind: "station", latitude: 34.9340, longitude: 135.7930, source: "seed", pref: "京都府" },
  "seed:nishinomiya-station": { id: "seed:nishinomiya-station", name: "西宮駅", kind: "station", latitude: 34.7386, longitude: 135.3485, source: "manual", pref: "兵庫県" },
};

export const SEED_ALIASES: readonly (readonly [string, string])[] = [
  ["宇治", "seed:uji"], ["京都", "seed:kyoto"], ["京都站", "seed:kyoto-station"],
  ["京都駅", "seed:kyoto-station"], ["東京駅", "seed:tokyo-station"], ["东京站", "seed:tokyo-station"],
  ["東京", "seed:tokyo"], ["东京", "seed:tokyo"], ["新宿", "seed:shinjuku"],
  ["秋叶原", "seed:akihabara"], ["秋葉原", "seed:akihabara"], ["飛騨高山", "seed:takayama"],
  ["高山", "seed:takayama"], ["鎌倉", "seed:kamakura"], ["镰仓", "seed:kamakura"],
  ["大阪", "seed:osaka"], ["渋谷", "seed:shibuya"], ["涩谷", "seed:shibuya"],
  ["池袋", "seed:ikebukuro"], ["横浜", "seed:yokohama"], ["横滨", "seed:yokohama"],
  ["奈良", "seed:nara"], ["広島", "seed:hiroshima"], ["広島駅", "seed:hiroshima-station"],
  ["名古屋", "seed:nagoya"], ["宇治駅", "seed:uji-station"], ["六地蔵", "seed:rokujizo"],
  ["西宮", "seed:nishinomiya-station"], ["西宫", "seed:nishinomiya-station"],
  ["nishinomiya", "seed:nishinomiya-station"],
];
