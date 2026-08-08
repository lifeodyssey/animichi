import { sql } from "drizzle-orm";
import type { CatalogDb } from "../../src/db/client";

/** A brand-new work id (not in seed()) so ingest exercises the full fetch ->
 * raw -> enrich -> publish pass against the real suite branch. */
export const NEW_WORK_ID = "10380"; // Bangumi subject id (K-On!)
export const NEW_TITLE = "けいおん！";

// A second uncovered work, reached via the search MISS path (Bangumi search ->
// resolve id -> ingest -> return). Distinct from NEW_WORK_ID so the two ingest
// E2Es don't collide in the shared suite branch.
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

/**
 * Seed one work (Lucky Star) with two nearby points and a normalized alias.
 * The points trigger derives `location` from latitude/longitude.
 */
export async function seed(db: CatalogDb): Promise<void> {
  await insertSeedBangumi(db);
  await insertSeedPoints(db);
  await insertSeedCluster(db);
  await insertSeedAlias(db);
  await seedOverviewWork(db);
}

function insertSeedBangumi(db: CatalogDb): Promise<unknown> {
  return db.execute(sql`
    INSERT INTO bangumi (id, title, title_cn, eps_count, rating, points_count)
    VALUES ('lucky-star', 'らき☆すた', '幸运星', 24, 8.1, 2)
  `);
}

function insertSeedPoints(db: CatalogDb): Promise<unknown> {
  return db.execute(sql`
    INSERT INTO points (id, bangumi_id, name, latitude, longitude, episode, time_seconds)
    VALUES
      ('washinomiya', 'lucky-star', '鷲宮神社', 36.1019, 139.6586, 1, 120),
      ('washinomiya-torii', 'lucky-star', '鷲宮神社 鳥居', 36.1025, 139.6590, 1, 60)
  `);
}

function insertSeedCluster(db: CatalogDb): Promise<unknown> {
  return db.execute(sql`
    INSERT INTO cluster_version (bangumi_id, version, is_current)
    VALUES ('lucky-star', 1, TRUE)
  `);
}

function insertSeedAlias(db: CatalogDb): Promise<unknown> {
  return db.execute(sql`
    INSERT INTO aliases (bangumi_id, alias, alias_normalized, source, priority)
    VALUES ('lucky-star', 'らき☆すた', 'らき☆すた', 'bangumi', 40)
  `);
}

/** A numeric-id work with two co-located Kamakura points + one Hakone point, for
 * the public animeOverview route (its input requires a numeric bangumi_id). */
export async function seedOverviewWork(db: CatalogDb): Promise<void> {
  await insertOverviewBangumi(db);
  await insertOverviewPoints(db);
}

function insertOverviewBangumi(db: CatalogDb): Promise<unknown> {
  return db.execute(sql`
    INSERT INTO bangumi (id, title, points_count) VALUES
      ('3302', 'Overview Work', 3),
      ('999998', 'Empty Overview Work', 0)
  `);
}

function insertOverviewPoints(db: CatalogDb): Promise<unknown> {
  return db.execute(sql`
    INSERT INTO points (id, bangumi_id, name, latitude, longitude, city, image)
    VALUES
      ('ov-kama-1', '3302', '鎌倉A', 35.30660, 139.48890, 'Kamakura', 'https://img/ov1.jpg'),
      ('ov-kama-2', '3302', '鎌倉B', 35.30661, 139.48891, 'Kamakura', NULL),
      ('ov-hakone', '3302', '箱根',  35.23230, 139.10690, 'Hakone',   'https://img/ov3.jpg')
  `);
}
