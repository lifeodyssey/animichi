import type { EnrichedRows } from "../enriched-rows";

/**
 * One work's raw zone and the catalog rows its enrich writes: the Lucky Star
 * Bangumi subject and three Anitabi points in the sources.ts upstream shapes,
 * two about 12 m apart (one 50 m cluster) and a far one (a second cluster).
 * `enrich.integration.test.ts` and `enrich-overlap.integration.test.ts` enrich
 * it; {@link LUCKY_STAR_ROWS} is what one enrich leaves, read by `enrichedRows`.
 */

export const RAW_BANGUMI = {
  id: 1,
  name: "らき☆すた",
  name_cn: "幸运星",
  summary: "高校生たちの日常コメディ。",
  images: { large: "https://lain.bgm.tv/pic/cover/l/lucky.jpg" },
  rating: { score: 8.1 },
  total_episodes: 24,
  date: "2007-04-08",
};

export const RAW_ANITABI = [
  { id: "p-washinomiya", name: "鷲宮神社", geo: [36.1019, 139.6586], image: "/2024/shrine.jpg", ep: 1, s: 42, origin: "バンダイチャンネル", originURL: "https://www.b-ch.com/ttl/index.php?ttl_c=1" },
  { id: "p-torii", cn: "鳥居", geo: [36.10199, 139.65861], image: "https://img/torii.jpg", ep: 1 },
  { id: "p-tokyo", name: "東京駅", lat: 35.6812, lng: 139.7671, screenshot: "/2024/tokyo.jpg", episode: 3 },
];

/** A point's columns enrich never writes. */
const UNWRITTEN_POINT_COLUMNS = { city: null, scene_desc: null };

/**
 * The rows one enrich of {@link RAW_BANGUMI} and {@link RAW_ANITABI} leaves
 * under the work id `lucky-star`. Columns enrich does not write keep their
 * defaults: `points_count` 0 and nulls.
 */
export const LUCKY_STAR_ROWS: EnrichedRows = {
  bangumi: [{
    id: "lucky-star", title: "らき☆すた", title_cn: "幸运星", cover_url: "https://lain.bgm.tv/pic/cover/l/lucky.jpg",
    summary: "高校生たちの日常コメディ。", rating: 8.1, eps_count: 24, air_date: "2007-04-08",
    points_count: 0, city: null, platform: null, primary_color: null,
  }],
  points: [
    {
      id: "p-tokyo", bangumi_id: "lucky-star", name: "東京駅", name_cn: null, latitude: 35.6812, longitude: 139.7671,
      location: "POINT(139.7671 35.6812)", image: "https://image.anitabi.cn/2024/tokyo.jpg", episode: 3, time_seconds: 0,
      origin: null, origin_url: null, ...UNWRITTEN_POINT_COLUMNS,
    },
    {
      id: "p-torii", bangumi_id: "lucky-star", name: "鳥居", name_cn: "鳥居", latitude: 36.10199, longitude: 139.65861,
      location: "POINT(139.65861 36.10199)", image: "https://img/torii.jpg", episode: 1, time_seconds: 0,
      origin: null, origin_url: null, ...UNWRITTEN_POINT_COLUMNS,
    },
    {
      id: "p-washinomiya", bangumi_id: "lucky-star", name: "鷲宮神社", name_cn: null, latitude: 36.1019, longitude: 139.6586,
      location: "POINT(139.6586 36.1019)", image: "https://image.anitabi.cn/2024/shrine.jpg", episode: 1, time_seconds: 42,
      origin: "バンダイチャンネル", origin_url: "https://www.b-ch.com/ttl/index.php?ttl_c=1", ...UNWRITTEN_POINT_COLUMNS,
    },
  ],
  aliases: [
    { bangumi_id: "lucky-star", alias: "らき☆すた", alias_normalized: "らき☆すた", source: "bangumi", priority: 40 },
    { bangumi_id: "lucky-star", alias: "幸运星", alias_normalized: "幸运星", source: "bangumi", priority: 40 },
  ],
};
