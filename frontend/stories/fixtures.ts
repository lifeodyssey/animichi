import type { RuntimeResponse, PilgrimagePoint } from "@/lib/types";

// --- Point factory ---

function makePoint(overrides: Partial<PilgrimagePoint> & { id: string }): PilgrimagePoint {
  return {
    name: "宇治橋",
    name_cn: "宇治桥",
    episode: 1,
    time_seconds: 120,
    screenshot_url: "https://image.anitabi.cn/bangumi/51/ep/00/202012210230491-20110320.jpg",
    bangumi_id: "51",
    latitude: 34.8891,
    longitude: 135.8074,
    title: "響け！ユーフォニアム",
    title_cn: "吹响吧！上低音号",
    origin: "anitabi",
    city: "宇治",
    ...overrides,
  };
}

// --- Point sets ---

export const POINTS_UJI: PilgrimagePoint[] = [
  makePoint({ id: "p1", name: "宇治橋", episode: 1, city: "宇治" }),
  makePoint({ id: "p2", name: "京阪宇治駅", episode: 1, city: "宇治" }),
  makePoint({ id: "p3", name: "宇治神社", episode: 3, city: "宇治" }),
  makePoint({ id: "p4", name: "北宇治高校", episode: 1, city: "宇治" }),
  makePoint({ id: "p5", name: "真柴豆腐店", episode: 5, city: "宇治" }),
];

export const POINTS_MIXED_AREAS: PilgrimagePoint[] = [
  ...POINTS_UJI,
  makePoint({ id: "p6", name: "伏見稲荷大社", episode: 7, city: "京都", latitude: 34.9671, longitude: 135.7727 }),
  makePoint({ id: "p7", name: "京都駅", episode: 8, city: "京都", latitude: 34.9856, longitude: 135.7588 }),
  makePoint({ id: "p8", name: "飛騨古川駅", episode: -1, city: "高山", latitude: 36.2378, longitude: 137.1862, title: "君の名は", bangumi_id: "317" }),
  makePoint({ id: "p9", name: "須賀神社", episode: -1, city: "東京", latitude: 35.6877, longitude: 139.7192, title: "君の名は", bangumi_id: "317" }),
];

export const POINTS_MANY: PilgrimagePoint[] = Array.from({ length: 60 }, (_, i) =>
  makePoint({
    id: `pm${String(i).padStart(3, "0")}`,
    name: `スポット ${i + 1}`,
    episode: (i % 12) + 1,
    city: ["宇治", "京都", "高山", "東京"][i % 4],
    latitude: 34.88 + (i % 10) * 0.01,
    longitude: 135.80 + (i % 10) * 0.01,
  }),
);

// --- Response factories ---

export function makeSearchResponse(
  points: PilgrimagePoint[],
  message = `${points.length}件の聖地が見つかりました`,
): RuntimeResponse {
  return {
    success: true,
    status: points.length > 0 ? "ok" : "empty",
    intent: "search_bangumi",
    message,
    data: {
      results: {
        rows: points,
        row_count: points.length,
        status: points.length > 0 ? "ok" : "empty",
        strategy: "sql",
        metadata: {
          anime_title: points[0]?.title ?? "",
          anime_title_cn: points[0]?.title_cn ?? "",
          cover_url: "https://image.anitabi.cn/bangumi/51.jpg",
          data_origin: "db",
        },
        summary: { count: points.length, source: "db", cache: "miss" },
        nearby_groups: [],
      },
    },
  } as unknown as RuntimeResponse;
}

export function makeRouteResponse(points: PilgrimagePoint[]): RuntimeResponse {
  return {
    success: true,
    status: "ok",
    intent: "plan_route",
    message: `${points.length}箇所のルートを計画しました`,
    data: {
      route: {
        ordered_points: points,
        point_count: points.length,
        cover_url: "https://image.anitabi.cn/bangumi/51.jpg",
        anime_title: points[0]?.title ?? "",
        anime_title_cn: points[0]?.title_cn ?? "",
        status: "ok",
        summary: { count: points.length, source: "db", cache: "miss" },
        timed_itinerary: { legs: [], total_walk_minutes: 0, start_time: "09:00" },
      },
    },
  } as unknown as RuntimeResponse;
}
