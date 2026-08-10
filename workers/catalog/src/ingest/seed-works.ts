/**
 * Checked-in seed list for the daily catalog pre-population cron (S0-v2 D4).
 *
 * Each entry is one well-known pilgrimage title with its stable Bangumi
 * subject id (the same id the ingest pipeline uses as `work_id`). Every id
 * below was resolved against the live Bangumi search API
 * (`POST /v0/search/subjects`, filter type=anime) and confirmed as the
 * relevance-head match on 2026-08-05 — no unresolved ids ship unchecked.
 * Re-verify against https://api.bgm.tv/v0/search/subjects when adding titles.
 */
export interface SeedBangumi {
  readonly bangumiId: string;
  readonly title: string;
}

/** Popular pilgrimage works to pre-populate the catalog (10 titles). */
export const SEED_BANGUMI: readonly SeedBangumi[] = [
  { bangumiId: "160209", title: "君の名は。 (Your Name)" },
  { bangumiId: "117777", title: "聲の形 (A Silent Voice)" },
  { bangumiId: "276", title: "らき☆すた (Lucky Star)" },
  { bangumiId: "1424", title: "けいおん! (K-On!)" },
  { bangumiId: "207195", title: "ゆるキャン△ (Laid-Back Camp)" },
  { bangumiId: "115908", title: "響け!ユーフォニアム (Sound! Euphonium)" },
  { bangumiId: "927", title: "秒速5センチメートル (5 Centimeters per Second)" },
  { bangumiId: "269235", title: "天気の子 (Weathering with You)" },
  { bangumiId: "362577", title: "すずめの戸締まり (Suzume)" },
  { bangumiId: "328609", title: "ぼっち・ざ・ろっく! (Bocchi the Rock!)" },
] as const;

/** The seed ids as a bare list, for the single done-check query. */
export const SEED_BANGUMI_IDS: readonly string[] = SEED_BANGUMI.map((work) => work.bangumiId);
