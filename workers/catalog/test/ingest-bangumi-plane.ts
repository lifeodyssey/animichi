import pg from "pg";
import { catalogIngestBangumi, type IngestBangumi } from "../src/ingest/ingest-bangumi";
import { ANITABI_EGRESS_BASE_URL } from "../src/ingest/anitabi-egress";
import type { FetchLike } from "../src/ingest/sources";
import { stubEgressSigningKey } from "./egress-stub";
import { openPlaneSeams, truncateCatalogPool, type PlaneSeams } from "./integration-db";

/**
 * The plane the IngestBangumi integration suites are driven through: canned
 * upstream doubles, the use case over the suite database, and the probes that
 * read its rows back. Two suites build on it, so it is named here once, for
 * what it provides (`.claude/rules/naming-ownership.md`):
 * `ingest-bangumi.integration.test.ts` holds the ingest lifecycle and
 * `ingest-bangumi-negative-cache.integration.test.ts` the negative cache.
 */

// Realistic upstream payloads matching the sources.ts shapes (mirrors fixtures/lucky-star-enrich.ts).
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
export const ANITABI_POINTS = [
  { id: "o-washinomiya", name: "鷲宮神社", geo: [36.1019, 139.6586], image: "/2024/shrine.jpg", ep: 1, s: 42 },
  { id: "o-tokyo", name: "東京駅", lat: 35.6812, lng: 139.7671, screenshot: "/2024/tokyo.jpg", episode: 3 },
];

/**
 * The anitabi arm of every double below is the EGRESS SERVICE's points route,
 * not the upstream's (#1792) — the catalog reaches api.anitabi.cn only through
 * it — and its answer carries the service's relayed marker, without which the
 * caller treats the answer as not ours.
 */
function isEgressPoints(url: string): boolean {
  return url.startsWith(`${ANITABI_EGRESS_BASE_URL}/anitabi/points/`);
}

/** The relayed marker the egress service stamps on an upstream's own answer. */
const RELAYED = { get: (name: string) => (name === "x-egress-response" ? "relayed-upstream" : null) };

/** Build a mock fetchImpl that routes by URL substring to the canned payloads. */
export function makeFetch(points: unknown): FetchLike {
  return (url) => Promise.resolve(
    isEgressPoints(url)
      ? { ok: true, status: 200, headers: RELAYED, json: () => Promise.resolve(points) }
      : { ok: true, status: 200, json: () => Promise.resolve(BANGUMI_SUBJECT) },
  );
}

/** A fetchImpl that throws — simulates an upstream/network failure. */
export const throwingFetch: FetchLike = () => { throw new Error("upstream exploded"); };

export const notFoundFetch: FetchLike = (url) => {
  if (isEgressPoints(url)) {
    return Promise.resolve({ ok: false, status: 404, headers: RELAYED, json: () => Promise.resolve(null) });
  }
  return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(BANGUMI_SUBJECT) });
};

/**
 * A fetchImpl gated on an external promise — the winner's pipeline parks here
 * (job still 'running') until released, so a concurrent caller's claim is
 * forced to observe the in-flight row and lose the singleflight race.
 */
export function makeGatedFetch(gate: Promise<void>): FetchLike {
  return async (url) => {
    await gate;
    return isEgressPoints(url)
      ? { ok: true, status: 200, headers: RELAYED, json: () => Promise.resolve(ANITABI_POINTS) }
      : { ok: true, status: 200, json: () => Promise.resolve(BANGUMI_SUBJECT) };
  };
}

let pool: pg.Pool;
let seams: PlaneSeams;

/** What a suite drives: the suite database's pool and the use case over the plane. */
export interface IngestPlane {
  readonly pool: pg.Pool;
  readonly ingest: IngestBangumi;
}

export async function pointCount(bangumiId: string): Promise<number> {
  const { rows } = await pool.query<{ n: number }>(
    "SELECT COUNT(*)::int AS n FROM points WHERE bangumi_id = $1", [bangumiId],
  );
  return rows[0]?.n ?? 0;
}

export async function bangumiExists(bangumiId: string): Promise<boolean> {
  const { rows } = await pool.query("SELECT 1 FROM bangumi WHERE id = $1", [bangumiId]);
  return rows.length > 0;
}

export async function jobStatus(bangumiId: string): Promise<string | undefined> {
  const { rows } = await pool.query(
    "SELECT status FROM ingest_jobs WHERE work_id = $1", [bangumiId],
  ) as { rows: { status: string }[] };
  return rows[0]?.status;
}

export async function backdateNegativeCache(bangumiId: string): Promise<void> {
  await pool.query(
    "UPDATE ingest_jobs SET negative_cached_until = NOW() - INTERVAL '1 second' WHERE work_id = $1", [bangumiId],
  );
}

export async function negativeCacheSeconds(bangumiId: string): Promise<number | undefined> {
  const { rows } = await pool.query(
    "SELECT EXTRACT(EPOCH FROM (negative_cached_until - NOW()))::int AS seconds"
    + " FROM ingest_jobs WHERE work_id = $1", [bangumiId],
  ) as { rows: { seconds: number }[] };
  return rows[0]?.seconds;
}

export async function awaitRunning(bangumiId: string): Promise<void> {
  for (let i = 0; i < 100; i++) {
    if ((await jobStatus(bangumiId)) === "running") return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`job ${bangumiId} never reached running`);
}

/** The suite's `beforeAll`: open the plane, empty the catalog, build the use case over it. */
export async function openIngestPlane(): Promise<IngestPlane> {
  seams = await openPlaneSeams();
  pool = seams.pool;
  await truncateCatalogPool(pool);
  return { pool, ingest: catalogIngestBangumi(seams.query, stubEgressSigningKey()) };
}

/** The suite's `afterAll`: give the plane's runtime back. */
export async function closeIngestPlane(): Promise<void> {
  await seams.dispose();
}
