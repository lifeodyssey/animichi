import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import pg from "pg";
import { makeDb, type CatalogDb } from "../src/db/client";
import { ingestGuard, ingestWork } from "../src/ingest/orchestrator";
import type { FetchLike } from "../src/ingest/sources";

/**
 * Spike for the on-demand ingest orchestrator (card W5): ingestWork composes the
 * committed pieces (acquire -> fetch -> raw -> enrich -> publish) behind the
 * singleflight gate, and proves its negative-cache / error semantics.
 *
 * Reuses the enrich.spike harness: applies the EXACT bangumi/points/raw-zone/
 * cluster_version/aliases DDL (plus ingest_jobs and the coordinate-sync trigger)
 * sliced from the real migrations to a Docker Postgres+PostGIS, then drives
 * ingestWork with an injected mock fetchImpl so we never touch the network.
 *
 * Unique container/port (catalog-orchestrator-postgis : 55438) so it never
 * clashes with postgis (55432), db (55433), geoquery (55434), ingest (55435),
 * publish (55436), enrich (55437), or local Supabase (54322).
 */

const CONTAINER = "catalog-orchestrator-postgis";
const IMAGE = "postgis/postgis:16-3.4";
const PG_PORT = 55438;
const PG_PASSWORD = "orchestrator";
const CONN = `postgresql://postgres:${PG_PASSWORD}@127.0.0.1:${String(PG_PORT)}/postgres`;

const REMOTE_SCHEMA = "../../supabase/migrations/20260402120000_remote_schema.sql";
const INGEST_SCHEMA = "../../supabase/migrations/20260620230000_ingest_infrastructure.sql";

// Statement markers sliced verbatim out of the real migrations — keeps the
// applied DDL authoritative. ingest_jobs is added for the singleflight gate.
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
  { from: "CREATE TABLE IF NOT EXISTS ingest_jobs (", to: ");" },
  { from: "CREATE TABLE IF NOT EXISTS cluster_version (", to: ");" },
  { from: "CREATE UNIQUE INDEX IF NOT EXISTS uq_cluster_version_one_current", to: ";" },
  { from: "CREATE TABLE IF NOT EXISTS aliases (", to: ");" },
  { from: "CREATE TABLE IF NOT EXISTS raw_anitabi (", to: ");" },
  { from: "CREATE TABLE IF NOT EXISTS raw_bangumi (", to: ");" },
];

// Realistic upstream payloads matching the sources.ts shapes (mirrors enrich.spike).
const BANGUMI_SUBJECT = {
  id: 1,
  name: "らき☆すた",
  name_cn: "幸运星",
  summary: "高校生たちの日常コメディ。",
  images: { large: "https://lain.bgm.tv/pic/cover/l/lucky.jpg" },
  rating: { score: 8.1 },
  total_episodes: 24,
  date: "2007-04-08",
};
const ANITABI_POINTS = [
  { id: "o-washinomiya", name: "鷲宮神社", geo: [36.1019, 139.6586], image: "/2024/shrine.jpg", ep: 1, s: 42 },
  { id: "o-tokyo", name: "東京駅", lat: 35.6812, lng: 139.7671, screenshot: "/2024/tokyo.jpg", episode: 3 },
];

/** Build a mock fetchImpl that routes by URL substring to the canned payloads. */
function makeFetch(points: unknown): FetchLike {
  return (url) => {
    const body = url.includes("/points/detail") ? points : BANGUMI_SUBJECT;
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
  };
}

/** A fetchImpl that throws — simulates an upstream/network failure. */
const throwingFetch: FetchLike = () => {
  throw new Error("upstream exploded");
};

const notFoundFetch: FetchLike = (url) => {
  if (url.includes("/points/detail")) {
    return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve(null) });
  }
  return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(BANGUMI_SUBJECT) });
};

/**
 * A fetchImpl gated on an external promise — the winner's pipeline parks here
 * (job still 'running') until released, so a concurrent caller's acquire is
 * forced to observe the in-flight row and lose the singleflight race.
 */
function makeGatedFetch(gate: Promise<void>): FetchLike {
  return async (url) => {
    await gate;
    const body = url.includes("/points/detail") ? ANITABI_POINTS : BANGUMI_SUBJECT;
    return { ok: true, status: 200, json: () => Promise.resolve(body) };
  };
}

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
  // and is never written by ingest; drop just that line.
  return blocks.join("\n\n").replace(/^\s*embedding\s+vector\(1024\),\n/m, "");
}

async function applyMigrations(): Promise<void> {
  await db.execute(sql`CREATE EXTENSION IF NOT EXISTS postgis`);
  await db.execute(sql.raw(buildSubsetDdl()));
}

async function pointCount(workId: string): Promise<number> {
  const rows = (
    await db.execute(sql`SELECT COUNT(*)::int AS n FROM points WHERE bangumi_id = ${workId}`)
  ).rows as { n: number }[];
  return rows[0]?.n ?? 0;
}

async function bangumiExists(workId: string): Promise<boolean> {
  const rows = (
    await db.execute(sql`SELECT 1 FROM bangumi WHERE id = ${workId}`)
  ).rows as { "?column?": number }[];
  return rows.length > 0;
}

async function currentVersion(workId: string): Promise<number | undefined> {
  const rows = (
    await db.execute(
      sql`SELECT version FROM cluster_version WHERE work_id = ${workId} AND is_current`,
    )
  ).rows as { version: number }[];
  return rows[0]?.version;
}

async function jobStatus(workId: string): Promise<string | undefined> {
  const rows = (
    await db.execute(sql`SELECT status FROM ingest_jobs WHERE work_id = ${workId}`)
  ).rows as { status: string }[];
  return rows[0]?.status;
}

async function backdateNegativeCache(workId: string): Promise<void> {
  await db.execute(
    sql`UPDATE ingest_jobs SET negative_cached_until = NOW() - INTERVAL '1 second' WHERE work_id = ${workId}`,
  );
}

async function negativeCacheSeconds(workId: string): Promise<number | undefined> {
  const rows = (await db.execute(sql`
    SELECT EXTRACT(EPOCH FROM (negative_cached_until - NOW()))::int AS seconds
    FROM ingest_jobs WHERE work_id = ${workId}
  `)).rows as { seconds: number }[];
  return rows[0]?.seconds;
}

async function awaitRunning(workId: string): Promise<void> {
  for (let i = 0; i < 100; i++) {
    if ((await jobStatus(workId)) === "running") return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`job ${workId} never reached running`);
}

beforeAll(async () => {
  startContainer();
  await waitForReady();
  db = makeDb(CONN);
  await applyMigrations();
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

describe("ingestWork end-to-end: acquire -> fetch -> raw -> enrich -> publish", () => {
  it("ingests a new work and lands it in the catalog with a current version", async () => {
    const result = await ingestWork(db, "new-work", { fetchImpl: makeFetch(ANITABI_POINTS) });
    expect(result).toEqual({ status: "ingested", version: 1, pointCount: 2 });
    expect(await bangumiExists("new-work")).toBe(true);
    expect(await pointCount("new-work")).toBe(2);
    expect(await currentVersion("new-work")).toBe(1);
    expect(await jobStatus("new-work")).toBe("done");
  });
});

describe("ingestWork singleflight: concurrent double ingest", () => {
  it("yields exactly one 'ingested' and one 'in_progress'", async () => {
    let release: () => void = () => { /* placeholder replaced by Promise constructor */ };
    const gate = new Promise<void>((r) => (release = r));
    // Winner parks in fetch (job 'running'); loser's acquire then loses the race.
    const winner = ingestWork(db, "race-work", { fetchImpl: makeGatedFetch(gate) });
    await awaitRunning("race-work");
    const loser = await ingestWork(db, "race-work", { fetchImpl: makeFetch(ANITABI_POINTS) });
    release();
    const a = await winner;
    const statuses = [a.status, loser.status].sort();
    expect(statuses).toEqual(["in_progress", "ingested"]);
    expect(await currentVersion("race-work")).toBe(1);
  });
});

describe("ingestWork empty upstream: no points", () => {
  it("returns 'empty', negative-caches, and blocks re-ingest within TTL", async () => {
    const fetchImpl = makeFetch([]);
    const result = await ingestWork(db, "empty-work", { fetchImpl });
    expect(result.status).toBe("empty");
    expect(await jobStatus("empty-work")).toBe("failed");
    expect(await bangumiExists("empty-work")).toBe(false);
    const retry = await ingestWork(db, "empty-work", { fetchImpl });
    expect(retry.status).toBe("empty");
  });

  it("parks an upstream 404 for seven days and exposes a genuine-empty guard", async () => {
    const result = await ingestWork(db, "404-work", { fetchImpl: notFoundFetch });
    const ttl = await negativeCacheSeconds("404-work");

    expect(result.status).toBe("empty");
    expect(ttl).toBeGreaterThan(6 * 24 * 60 * 60);
    expect(ttl).toBeLessThanOrEqual(7 * 24 * 60 * 60);
    await expect(ingestGuard(db, "404-work")).resolves.toBe("empty");
  });
});

describe("ingestWork failed upstream: fetch throws", () => {
  it("throws typed upstream-unavailable and leaves a re-acquirable job", async () => {
    await expect(ingestWork(db, "boom-work", { fetchImpl: throwingFetch })).rejects.toMatchObject({
      code: "UPSTREAM_UNAVAILABLE",
      defined: true,
      status: 502,
    });
    expect(await jobStatus("boom-work")).toBe("failed");
    // After the negative-cache TTL elapses the work re-acquires and succeeds.
    await backdateNegativeCache("boom-work");
    const retry = await ingestWork(db, "boom-work", { fetchImpl: makeFetch(ANITABI_POINTS) });
    expect(retry.status).toBe("ingested");
    expect(await jobStatus("boom-work")).toBe("done");
  });
});
