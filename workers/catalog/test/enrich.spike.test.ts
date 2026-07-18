import { afterAll, beforeAll, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import type { CatalogDb } from "../src/db/client";
import { saveRawAnitabi, saveRawBangumi } from "../src/ingest/raw-store";
import { enrichWork } from "../src/enrich/enrich";
import {
  databaseDescribe,
  openServerlessDb,
  restoreNeonConfig,
  truncateCatalog,
} from "./spike-db";

/**
 * Spike for the Enrich stage (card W3-2): raw zone -> enriched catalog -> publish.
 *
 * Uses the complete Atlas schema inherited from `test-base`, then seeds realistic
 * raw payloads before driving enrichWork through Neon Local's HTTP endpoint.
 */

// Realistic raw payloads matching the sources.ts upstream shapes.
const RAW_BANGUMI = {
  id: 1,
  name: "らき☆すた",
  name_cn: "幸运星",
  summary: "高校生たちの日常コメディ。",
  images: { large: "https://lain.bgm.tv/pic/cover/l/lucky.jpg" },
  rating: { score: 8.1 },
  total_episodes: 24,
  date: "2007-04-08",
};
// Two points ~12m apart (one 50m cluster) + a far one (a second cluster).
const RAW_ANITABI = [
  { id: "p-washinomiya", name: "鷲宮神社", geo: [36.1019, 139.6586], image: "/2024/shrine.jpg", ep: 1, s: 42 },
  { id: "p-torii", cn: "鳥居", geo: [36.10199, 139.65861], image: "https://img/torii.jpg", ep: 1 },
  { id: "p-tokyo", name: "東京駅", lat: 35.6812, lng: 139.7671, screenshot: "/2024/tokyo.jpg", episode: 3 },
];

let db: CatalogDb;

async function pointCount(workId: string): Promise<number> {
  const rows = (
    await db.execute(
      sql`SELECT COUNT(*)::int AS n FROM points WHERE bangumi_id = ${workId}`,
    )
  ).rows as { n: number }[];
  return rows[0]?.n ?? 0;
}

async function locationWkt(pointId: string): Promise<string | null> {
  const rows = (
    await db.execute(sql`SELECT ST_AsText(location) AS wkt FROM points WHERE id = ${pointId}`)
  ).rows as { wkt: string | null }[];
  return rows[0]?.wkt ?? null;
}

async function currentVersion(workId: string): Promise<number | undefined> {
  const rows = (
    await db.execute(
      sql`SELECT version FROM cluster_version WHERE work_id = ${workId} AND is_current`,
    )
  ).rows as { version: number }[];
  return rows[0]?.version;
}

async function allVersions(workId: string): Promise<number[]> {
  const rows = (
    await db.execute(
      sql`SELECT version FROM cluster_version WHERE work_id = ${workId} ORDER BY version`,
    )
  ).rows as { version: number }[];
  return rows.map((r) => r.version);
}

beforeAll(async () => {
  db = await openServerlessDb();
  await truncateCatalog(db);
  await saveRawBangumi(db, "lucky-star", RAW_BANGUMI);
  await saveRawAnitabi(db, "lucky-star", RAW_ANITABI);
}, 120_000);

afterAll(() => { restoreNeonConfig(); });

async function assertEnrichBangumiRow(): Promise<void> {
  const rows = (
    await db.execute(
      sql`SELECT title, title_cn, cover_url, rating, eps_count, air_date
          FROM bangumi WHERE id = 'lucky-star'`,
    )
  ).rows as { title: string; title_cn: string; cover_url: string; rating: number; eps_count: number; air_date: string }[];
  const row = rows[0];
  expect(row?.title).toBe("らき☆すた");
  expect(row?.title_cn).toBe("幸运星");
  expect(row?.cover_url).toBe("https://lain.bgm.tv/pic/cover/l/lucky.jpg");
  expect(Number(row?.rating)).toBeCloseTo(8.1, 1);
  expect(row?.eps_count).toBe(24);
  expect(row?.air_date).toBe("2007-04-08");
}

async function assertEnrichAliases(): Promise<void> {
  const rows = (
    await db.execute(
      sql`SELECT alias, alias_normalized, source FROM aliases
          WHERE work_id = 'lucky-star' ORDER BY alias_normalized`,
    )
  ).rows as { alias: string; alias_normalized: string; source: string }[];
  const normalized = rows.map((r) => r.alias_normalized);
  expect(normalized).toContain("らき☆すた".normalize("NFKC").toLowerCase());
  expect(normalized).toContain("幸运星");
  expect(rows.every((r) => r.source === "bangumi")).toBe(true);
}

databaseDescribe("enrichWork composes raw zone -> enriched catalog -> publish", () => {
  it("returns the published version and point count", async () => {
    const result = await enrichWork(db, "lucky-star");
    expect(result.version).toBe(1);
    expect(result.pointCount).toBe(3);
  });

  it("writes the bangumi row parsed from the raw subject", assertEnrichBangumiRow);

  it("writes points with coords and trigger-derived geography location", async () => {
    expect(await pointCount("lucky-star")).toBe(3);
    const wkt = await locationWkt("p-washinomiya");
    expect(wkt).toMatch(/^POINT\(139\.6586 36\.1019\)$/);
  });

  it("expands leading-slash Anitabi image paths to the CDN host", async () => {
    const rows = (
      await db.execute(sql`SELECT image FROM points WHERE id = 'p-washinomiya'`)
    ).rows as { image: string }[];
    expect(rows[0]?.image).toBe("https://image.anitabi.cn/2024/shrine.jpg");
  });

  it("writes normalized aliases from the bangumi titles", assertEnrichAliases);

  it("publishes a current cluster_version", async () => {
    expect(await currentVersion("lucky-star")).toBe(1);
  });
});

databaseDescribe("re-enrich from raw is idempotent and publishes a new version", () => {
  it("does not duplicate points and bumps to a new current version", async () => {
    const result = await enrichWork(db, "lucky-star");
    expect(result.version).toBe(2);
    expect(result.pointCount).toBe(3);
    expect(await pointCount("lucky-star")).toBe(3);
    expect(await allVersions("lucky-star")).toEqual([1, 2]);
    expect(await currentVersion("lucky-star")).toBe(2);
  });
});

databaseDescribe("enrichWork throws when the raw zone is missing a payload", () => {
  it("rejects a work with no raw_bangumi / raw_anitabi rows", async () => {
    await expect(enrichWork(db, "absent-work")).rejects.toThrow(/No raw_bangumi/);
  });
});
