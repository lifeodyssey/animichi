import { afterAll, beforeAll, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import type { CatalogDb } from "../src/db/client";
import { ingestGuard, ingestWork } from "../src/ingest/orchestrator";
import type { FetchLike } from "../src/ingest/sources";
import {
  databaseDescribeKnownFailing,
  openServerlessDb,
  restoreNeonConfig,
  truncateCatalog,
} from "./spike-db";

/**
 * Spike for the on-demand ingest orchestrator (card W5): ingestWork composes the
 * committed pieces (acquire -> fetch -> raw -> enrich -> publish) behind the
 * singleflight gate, and proves its negative-cache / error semantics.
 *
 * Uses the suite branch's full Atlas schema and drives ingestWork through Neon
 * Local HTTP with an injected mock fetchImpl, so upstream access stays offline.
 */

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
  db = await openServerlessDb();
  await truncateCatalog(db);
}, 120_000);

afterAll(() => { restoreNeonConfig(); });

databaseDescribeKnownFailing("#362", "ingestWork end-to-end: acquire -> fetch -> raw -> enrich -> publish", () => {
  it("ingests a new work and lands it in the catalog with a current version", async () => {
    const result = await ingestWork(db, "new-work", { fetchImpl: makeFetch(ANITABI_POINTS) });
    expect(result).toEqual({ status: "ingested", version: 1, pointCount: 2 });
    expect(await bangumiExists("new-work")).toBe(true);
    expect(await pointCount("new-work")).toBe(2);
    expect(await currentVersion("new-work")).toBe(1);
    expect(await jobStatus("new-work")).toBe("done");
  });
});

databaseDescribeKnownFailing("#362", "ingestWork singleflight: concurrent double ingest", () => {
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

databaseDescribeKnownFailing("#362", "ingestWork empty upstream: no points", () => {
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

databaseDescribeKnownFailing("#362", "ingestWork failed upstream: fetch throws", () => {
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
