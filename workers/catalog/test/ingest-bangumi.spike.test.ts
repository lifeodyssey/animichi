import { afterAll, beforeAll, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import type { CatalogDb } from "../src/db/client";
import { catalogIngestBangumi, type IngestBangumi } from "../src/ingest/ingest-bangumi";
import type { FetchLike } from "../src/ingest/sources";
import {
  databaseDescribe,
  openServerlessDb,
  restoreNeonConfig,
  truncateCatalog,
} from "./spike-db";

/**
 * Spike for the IngestBangumi use case: acquire -> fetch -> raw -> enrich ->
 * publish -> completion over the source/store/publisher ports, with singleflight,
 * negative-cache TTLs, crash recovery, and idempotent replay (mirrors the
 * worker-pool component tests against the real Atlas schema on Neon Local).
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
 * (job still 'running') until released, so a concurrent caller's claim is
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
let ingest: IngestBangumi;

async function pointCount(bangumiId: string): Promise<number> {
  const rows = (await db.execute(sql`SELECT COUNT(*)::int AS n FROM points WHERE bangumi_id = ${bangumiId}`)).rows as { n: number }[];
  return rows[0]?.n ?? 0;
}

async function bangumiExists(bangumiId: string): Promise<boolean> {
  const rows = (await db.execute(sql`SELECT 1 FROM bangumi WHERE id = ${bangumiId}`)).rows as { "?column?": number }[];
  return rows.length > 0;
}

async function currentVersion(bangumiId: string): Promise<number | undefined> {
  const rows = (await db.execute(sql`SELECT version FROM cluster_version WHERE bangumi_id = ${bangumiId} AND is_current`)).rows as { version: number }[];
  return rows[0]?.version;
}

async function jobStatus(bangumiId: string): Promise<string | undefined> {
  const rows = (await db.execute(sql`SELECT status FROM ingest_jobs WHERE work_id = ${bangumiId}`)).rows as { status: string }[];
  return rows[0]?.status;
}

async function backdateNegativeCache(bangumiId: string): Promise<void> {
  await db.execute(sql`UPDATE ingest_jobs SET negative_cached_until = NOW() - INTERVAL '1 second' WHERE work_id = ${bangumiId}`);
}

async function negativeCacheSeconds(bangumiId: string): Promise<number | undefined> {
  const rows = (await db.execute(sql`
    SELECT EXTRACT(EPOCH FROM (negative_cached_until - NOW()))::int AS seconds
    FROM ingest_jobs WHERE work_id = ${bangumiId}
  `)).rows as { seconds: number }[];
  return rows[0]?.seconds;
}

async function awaitRunning(bangumiId: string): Promise<void> {
  for (let i = 0; i < 100; i++) {
    if ((await jobStatus(bangumiId)) === "running") return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`job ${bangumiId} never reached running`);
}

beforeAll(async () => {
  db = await openServerlessDb();
  await truncateCatalog(db);
  ingest = catalogIngestBangumi(db);
}, 120_000);

afterAll(() => { restoreNeonConfig(); });

databaseDescribe("IngestBangumi end-to-end: claim -> fetch -> raw -> enrich -> publish -> done", () => {
  it("ingests a new title and lands it in the catalog with one current version", async () => {
    const result = await ingest.ingest("460100", { fetchImpl: makeFetch(ANITABI_POINTS) });
    expect(result).toEqual({ status: "ingested", version: 1, pointCount: 2 });
    expect(await bangumiExists("460100")).toBe(true);
    expect(await pointCount("460100")).toBe(2);
    expect(await currentVersion("460100")).toBe(1);
    expect(await jobStatus("460100")).toBe("done");
  });
});

databaseDescribe("IngestBangumi claim uniqueness: concurrent double ingest", () => {
  it("yields exactly one 'ingested' and one 'in_progress'", async () => {
    let release: () => void = () => { /* placeholder replaced by Promise constructor */ };
    const gate = new Promise<void>((r) => (release = r));
    // Winner parks in fetch (job 'running'); loser's claim then loses the race.
    const winner = ingest.ingest("460101", { fetchImpl: makeGatedFetch(gate) });
    await awaitRunning("460101");
    const loser = await ingest.ingest("460101", { fetchImpl: makeFetch(ANITABI_POINTS) });
    release();
    const a = await winner;
    const statuses = [a.status, loser.status].sort();
    expect(statuses).toEqual(["in_progress", "ingested"]);
    expect(await currentVersion("460101")).toBe(1);
  });
});

databaseDescribe("IngestBangumi negative cache: empty upstream", () => {
  it("returns 'empty', parks the empty TTL, and blocks re-ingest within it", async () => {
    const fetchImpl = makeFetch([]);
    const result = await ingest.ingest("460102", { fetchImpl });
    expect(result.status).toBe("empty");
    expect(await jobStatus("460102")).toBe("failed");
    expect(await bangumiExists("460102")).toBe(false);
    const retry = await ingest.ingest("460102", { fetchImpl });
    expect(retry.status).toBe("empty");
  });

  it("parks an upstream 404 for seven days and exposes a genuine-empty guard", async () => {
    const result = await ingest.ingest("460104", { fetchImpl: notFoundFetch });
    const ttl = await negativeCacheSeconds("460104");

    expect(result.status).toBe("empty");
    expect(ttl).toBeGreaterThan(6 * 24 * 60 * 60);
    expect(ttl).toBeLessThanOrEqual(7 * 24 * 60 * 60);
    await expect(ingest.guard("460104")).resolves.toBe("empty");
  });
});

databaseDescribe("IngestBangumi retryable upstream: fetch throws", () => {
  it("throws typed upstream-unavailable and leaves a re-acquirable job", async () => {
    await expect(ingest.ingest("460103", { fetchImpl: throwingFetch })).rejects.toMatchObject({
      code: "UPSTREAM_UNAVAILABLE",
      defined: true,
      status: 502,
    });
    expect(await jobStatus("460103")).toBe("failed");
    // After the negative-cache TTL elapses the title re-acquires and succeeds.
    await backdateNegativeCache("460103");
    const retry = await ingest.ingest("460103", { fetchImpl: makeFetch(ANITABI_POINTS) });
    expect(retry.status).toBe("ingested");
    expect(await jobStatus("460103")).toBe("done");
  });
});

databaseDescribe("IngestBangumi crash recovery + idempotent replay", () => {
  it("reclaims a stale running claim (crashed peer) and completes it", async () => {
    await db.execute(sql`
      INSERT INTO ingest_jobs (work_id, status, started_at)
      VALUES ('460105', 'running', NOW() - INTERVAL '16 minutes')
    `);
    const result = await ingest.ingest("460105", { fetchImpl: makeFetch(ANITABI_POINTS) });
    expect(result.status).toBe("ingested");
    expect(await jobStatus("460105")).toBe("done");
  });

  it("re-ingests idempotently: re-enrich upserts, no duplicate points, version bumps once", async () => {
    await ingest.ingest("460106", { fetchImpl: makeFetch(ANITABI_POINTS) });
    await ingest.ingest("460106", { fetchImpl: makeFetch(ANITABI_POINTS) });

    expect(await pointCount("460106")).toBe(2);
    expect(await currentVersion("460106")).toBe(2);
    expect(await jobStatus("460106")).toBe("done");
  });
});
