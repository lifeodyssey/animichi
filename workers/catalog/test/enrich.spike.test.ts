import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import pg from "pg";
import { makeDb, type CatalogDb } from "../src/db/client";
import { saveRawAnitabi, saveRawBangumi } from "../src/ingest/raw-store";
import { enrichWork } from "../src/enrich/enrich";

/**
 * Spike for the Enrich stage (card W3-2): raw zone -> enriched catalog -> publish.
 *
 * Reuses the db.spike harness: applies the EXACT bangumi/points DDL (plus the
 * update + coordinate-sync functions/triggers) and the cluster_version / aliases /
 * raw-zone DDL sliced from the real migrations to a Docker Postgres+PostGIS, seeds
 * realistic raw payloads (matching sources.ts shapes), then drives enrichWork and
 * reads the catalog rows back. The points trigger derives `location` from lat/lng,
 * so we verify it via ST_AsText.
 *
 * Unique container/port (catalog-enrich-postgis : 55437) so it never clashes with
 * postgis (55432), db (55433), geoquery (55434), ingest (55435), publish (55436),
 * or local Supabase (54322).
 */

const CONTAINER = "catalog-enrich-postgis";
const IMAGE = "postgis/postgis:16-3.4";
const PG_PORT = 55437;
const PG_PASSWORD = "enrich";
const CONN = `postgresql://postgres:${PG_PASSWORD}@127.0.0.1:${String(PG_PORT)}/postgres`;

const REMOTE_SCHEMA = "../../supabase/migrations/20260402120000_remote_schema.sql";
const INGEST_SCHEMA = "../../supabase/migrations/20260620230000_ingest_infrastructure.sql";

// Statement markers sliced verbatim out of the real migrations — keeps the applied
// DDL authoritative without dragging in vector/auth-dependent tables. The points
// coordinate-sync trigger + function are required so enrich's lat/lng insert
// populates the GEOGRAPHY `location` column.
const REMOTE_BLOCKS = [
  { from: "CREATE TABLE IF NOT EXISTS bangumi (", to: ");" },
  { from: "CREATE OR REPLACE FUNCTION update_updated_at()", to: "$$ LANGUAGE plpgsql;" },
  { from: "CREATE TABLE IF NOT EXISTS points (", to: ");" },
  { from: "CREATE OR REPLACE FUNCTION sync_points_coordinates()", to: "$$ LANGUAGE plpgsql;" },
  {
    from: "CREATE TRIGGER trg_points_sync_coordinates",
    to: "FOR EACH ROW EXECUTE FUNCTION sync_points_coordinates();",
  },
];
const INGEST_BLOCKS = [
  { from: "CREATE TABLE IF NOT EXISTS cluster_version (", to: ");" },
  { from: "CREATE UNIQUE INDEX IF NOT EXISTS uq_cluster_version_one_current", to: ";" },
  { from: "CREATE TABLE IF NOT EXISTS aliases (", to: ");" },
  { from: "CREATE TABLE IF NOT EXISTS raw_anitabi (", to: ");" },
  { from: "CREATE TABLE IF NOT EXISTS raw_bangumi (", to: ");" },
];

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

function sh(cmd: string): string {
  return execSync(cmd, { stdio: ["ignore", "pipe", "pipe"] }).toString().trim();
}

function sliceBlock(src: string, from: string, to: string): string {
  const start = src.indexOf(from);
  if (start < 0) throw new Error(`marker not found: ${from}`);
  const end = src.indexOf(to, start);
  if (end < 0) throw new Error(`end marker not found: ${to}`);
  return src.slice(start, end + to.length);
}

function startContainer(): void {
  const existing = sh(`docker ps -aq -f name=^${CONTAINER}$`);
  if (existing) sh(`docker rm -f ${CONTAINER}`);
  sh(
    `docker run -d --name ${CONTAINER} -e POSTGRES_PASSWORD=${PG_PASSWORD} ` +
      `-p ${String(PG_PORT)}:5432 ${IMAGE}`,
  );
}

async function waitForReady(): Promise<void> {
  const deadline = Date.now() + 90_000;
  let lastErr: unknown;
  while (Date.now() < deadline) {
    const probe = new pg.Pool({ connectionString: CONN, max: 1 });
    try {
      await probe.query("SELECT 1");
      await probe.end();
      return;
    } catch (err) {
      lastErr = err;
      await probe.end().catch(() => { /* noop */ });
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  throw new Error(`Postgres not ready in time: ${String(lastErr)}`);
}

function readMigration(rel: string): string {
  return readFileSync(resolve(import.meta.dirname, rel), "utf8");
}

function buildSubsetDdl(): string {
  const remote = readMigration(REMOTE_SCHEMA);
  const ingest = readMigration(INGEST_SCHEMA);
  const blocks = [
    ...REMOTE_BLOCKS.map((b) => sliceBlock(remote, b.from, b.to)),
    ...INGEST_BLOCKS.map((b) => sliceBlock(ingest, b.from, b.to)),
  ];
  // `embedding vector(1024)` needs pgvector (absent on the plain postgis image)
  // and is never written by enrich; drop just that line.
  return blocks.join("\n\n").replace(/^\s*embedding\s+vector\(1024\),\n/m, "");
}

async function applyMigrations(): Promise<void> {
  await db.execute(sql`CREATE EXTENSION IF NOT EXISTS postgis`);
  await db.execute(sql.raw(buildSubsetDdl()));
}

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
  startContainer();
  await waitForReady();
  db = makeDb(CONN);
  await applyMigrations();
  await saveRawBangumi(db, "lucky-star", RAW_BANGUMI);
  await saveRawAnitabi(db, "lucky-star", RAW_ANITABI);
}, 120_000);

afterAll(async () => {
  const client = (db as unknown as { $client?: pg.Pool }).$client;
  if (client) await client.end().catch(() => { /* noop */ });
  try {
    sh(`docker rm -f ${CONTAINER}`);
  } catch {
    /* container already gone */
  }
});

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

describe("enrichWork composes raw zone -> enriched catalog -> publish", () => {
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

describe("re-enrich from raw is idempotent and publishes a new version", () => {
  it("does not duplicate points and bumps to a new current version", async () => {
    const result = await enrichWork(db, "lucky-star");
    expect(result.version).toBe(2);
    expect(result.pointCount).toBe(3);
    expect(await pointCount("lucky-star")).toBe(3);
    expect(await allVersions("lucky-star")).toEqual([1, 2]);
    expect(await currentVersion("lucky-star")).toBe(2);
  });
});

describe("enrichWork throws when the raw zone is missing a payload", () => {
  it("rejects a work with no raw_bangumi / raw_anitabi rows", async () => {
    await expect(enrichWork(db, "absent-work")).rejects.toThrow(/No raw_bangumi/);
  });
});
