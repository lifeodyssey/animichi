import type pg from "pg";
import {
  aliasInsert,
  aliasSeed,
  clusterVersionInsert,
  clusterVersionSeed,
  pointInsert,
  pointSeed,
  runSeed,
  workInsert,
  workSeed,
} from "./catalog-seed";

/** A brand-new work id (not in seed()) so ingest exercises the full fetch ->
 * raw -> enrich -> publish pass against the real suite database. */
export const NEW_WORK_ID = "10380"; // Bangumi subject id (K-On!)
export const NEW_TITLE = "けいおん！";

// A second uncovered work, reached via the search MISS path (Bangumi search ->
// resolve id -> ingest -> return). Distinct from NEW_WORK_ID so the two ingest
// E2Es don't collide in the shared suite database.
export const MISS_WORK_ID = "100020"; // Bangumi subject id (Hibike! Euphonium)
export const MISS_TITLE = "響け！ユーフォニアム";

export const MISS_POINTS = [
  { id: "uji-bridge", name: "宇治橋", lat: 34.8915, lng: 135.8078, ep: 1, s: 45 },
  { id: "keihan-uji", name: "京阪宇治駅", lat: 34.8908, lng: 135.8112, ep: 1, s: 80 },
];

export const ANITABI_POINTS = [
  { id: "sakuragaoka-gate", name: "桜が丘高校 正門", lat: 34.6571, lng: 135.9486, ep: 1, s: 30 },
  { id: "toyosato-hall", name: "豊郷小学校 講堂", lat: 35.205, lng: 136.2401, ep: 2, s: 90 },
];

/** The suite's main work (Lucky Star), built through the contract so its id is
 * numeric: `pointsByBangumiId` (`/^\d+$/`) would reject a `lucky-star` slug. */
export const SEED_WORK = workSeed("2823", "らき☆すた", {
  titleCn: "幸运星",
  epsCount: 24,
  rating: 8.1,
  pointsCount: 2,
});

/** A numeric-id work with two co-located Kamakura points + one Hakone point, for
 * the public animeOverview route (its input requires a numeric bangumi_id). */
const OVERVIEW_WORK = workSeed("3302", "Overview Work", { pointsCount: 3 });
const OVERVIEW_EMPTY_WORK = workSeed("999998", "Empty Overview Work", { pointsCount: 0 });

/** The seeded points: the main work's two Washinomiya spots, then the overview set. */
const SEED_POINTS = [
  pointSeed("washinomiya", SEED_WORK, "鷲宮神社", 36.1019, 139.6586, { episode: 1, timeSeconds: 120 }),
  pointSeed("washinomiya-torii", SEED_WORK, "鷲宮神社 鳥居", 36.1025, 139.659, { episode: 1, timeSeconds: 60 }),
  pointSeed("ov-kama-1", OVERVIEW_WORK, "鎌倉A", 35.3066, 139.4889, {
    city: "Kamakura", image: "https://img/ov1.jpg",
  }),
  pointSeed("ov-kama-2", OVERVIEW_WORK, "鎌倉B", 35.30661, 139.48891, { city: "Kamakura" }),
  pointSeed("ov-hakone", OVERVIEW_WORK, "箱根", 35.2323, 139.1069, {
    city: "Hakone", image: "https://img/ov3.jpg",
  }),
];

/**
 * Seed the suite's works with their nearby points, one cluster version and a
 * normalized alias.
 *
 * Points are written through `location`: `latitude` / `longitude` are generated
 * columns on this plane, so a scalar write is `cannot insert a non-DEFAULT value
 * into column "latitude"` (`428C9`).
 */
export async function seed(pool: pg.Pool): Promise<void> {
  await seedBangumi(pool);
  await seedPoints(pool);
  await seedCluster(pool);
  await seedAlias(pool);
}

function seedBangumi(pool: pg.Pool): Promise<void> {
  return runSeed(pool, workInsert([SEED_WORK, OVERVIEW_WORK, OVERVIEW_EMPTY_WORK]));
}

function seedPoints(pool: pg.Pool): Promise<void> {
  return runSeed(pool, pointInsert(SEED_POINTS));
}

function seedCluster(pool: pg.Pool): Promise<void> {
  return runSeed(pool, clusterVersionInsert([clusterVersionSeed(SEED_WORK, 1, true)]));
}

function seedAlias(pool: pg.Pool): Promise<void> {
  return runSeed(pool, aliasInsert([aliasSeed(SEED_WORK, "らき☆すた", "らき☆すた", "bangumi", 40)]));
}
