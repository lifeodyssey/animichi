import { afterAll, beforeAll, expect, it } from "vitest";
import type pg from "pg";
import type { CatalogPrisma } from "../src/db/prisma";
import { listDrainableBangumiIds, listStaleBangumiIds, STALE_AFTER_SECONDS } from "../src/ingest/cron-queries";
import {
  catalogTruncateSql,
  databaseDescribe,
  openPlanePrisma,
  planePool,
  restoreNeonConfig,
  type PlanePrisma,
} from "./integration-db";

/**
 * Integration suite for the cron staleness query (S0-v2 D4 fix round): the three
 * staleness shapes against REAL Postgres — both sources fresh, one source stale,
 * one source entirely absent — plus the negative-cache exclusion, the batch cap,
 * and the TTL freshness floor.
 *
 * This is where the staleness query's SEMANTICS live since #1630: the plan is a
 * FULL OUTER JOIN whose `LEAST(COALESCE(…, '-infinity'), …)` ordering and whose
 * correlated anti-join cannot be checked against a fake, and the worker suite now
 * only pins the statement count and the bound values.
 *
 * The fixtures are written with a plain pool rather than through the seam under
 * test, so a query that reads its own writes cannot hide a missing row.
 */

let seams: PlanePrisma;
let query: CatalogPrisma;
let pool: pg.Pool;

const ONE_HOUR = 60 * 60;
const TWO_DAYS = 2 * 24 * 60 * 60;

async function insertRaw(
  table: "raw_anitabi" | "raw_bangumi",
  workId: string,
  ageSeconds: number,
): Promise<void> {
  const name = table === "raw_anitabi" ? "raw_anitabi" : "raw_bangumi";
  await pool.query(
    `INSERT INTO ${name} (work_id, payload, fetched_at)
     VALUES ($1, '{}'::jsonb, NOW() - make_interval(secs => $2))`,
    [workId, ageSeconds],
  );
}

async function insertNegativeCache(workId: string, secondsFromNow: number): Promise<void> {
  await pool.query(
    `INSERT INTO ingest_jobs (work_id, status, negative_cached_until)
     VALUES ($1, 'failed', NOW() + make_interval(secs => $2))`,
    [workId, secondsFromNow],
  );
}

async function truncate(): Promise<void> {
  await pool.query(catalogTruncateSql());
}

beforeAll(async () => {
  seams = await openPlanePrisma();
  query = seams.query;
  pool = planePool();
  await truncate();
}, 120_000);

afterAll(async () => {
  await seams.dispose();
  restoreNeonConfig();
});

databaseDescribe("listStaleBangumiIds staleness shapes", () => {
  beforeAll(async () => {
    await truncate();
    await insertRaw("raw_anitabi", "both-fresh", ONE_HOUR);
    await insertRaw("raw_bangumi", "both-fresh", ONE_HOUR);
    await insertRaw("raw_anitabi", "one-stale", TWO_DAYS);
    await insertRaw("raw_bangumi", "one-stale", ONE_HOUR);
    await insertRaw("raw_anitabi", "missing-source", ONE_HOUR);
    await insertRaw("raw_anitabi", "neg-cached", TWO_DAYS);
    await insertRaw("raw_bangumi", "neg-cached", TWO_DAYS);
    await insertNegativeCache("neg-cached", ONE_HOUR);
    await insertRaw("raw_anitabi", "cache-lapsed", TWO_DAYS);
    await insertRaw("raw_bangumi", "cache-lapsed", TWO_DAYS);
    await insertNegativeCache("cache-lapsed", -ONE_HOUR);
  }, 60_000);

  it("keeps a work fresh only while BOTH sources are fresh", async () => {
    const stale = await listStaleBangumiIds(query, 10, STALE_AFTER_SECONDS);
    expect(stale).not.toContain("both-fresh");
  });

  it("selects a work when ONE source is stale, even if the other is fresh", async () => {
    const stale = await listStaleBangumiIds(query, 10, STALE_AFTER_SECONDS);
    expect(stale).toContain("one-stale");
  });

  it("selects a work when ONE source row is entirely absent", async () => {
    const stale = await listStaleBangumiIds(query, 10, STALE_AFTER_SECONDS);
    expect(stale).toContain("missing-source");
  });

  it("skips works behind a live failure negative-cache", async () => {
    const stale = await listStaleBangumiIds(query, 10, STALE_AFTER_SECONDS);
    expect(stale).not.toContain("neg-cached");
  });

  it("re-admits a failed work once its negative-cache has lapsed", async () => {
    const stale = await listStaleBangumiIds(query, 10, STALE_AFTER_SECONDS);
    expect(stale).toContain("cache-lapsed");
  });
});

databaseDescribe("listStaleBangumiIds batch cap and freshness floor", () => {
  beforeAll(async () => {
    await truncate();
    for (let days = 2; days <= 8; days += 1) {
      await insertRaw("raw_anitabi", "stale-" + String(days) + "d", days * 24 * 60 * 60);
      await insertRaw("raw_bangumi", "stale-" + String(days) + "d", days * 24 * 60 * 60);
    }
    await insertRaw("raw_anitabi", "still-fresh", ONE_HOUR);
    await insertRaw("raw_bangumi", "still-fresh", ONE_HOUR);
  }, 60_000);

  it("returns at most the cap, oldest-first, excluding fresh works", async () => {
    const stale = await listStaleBangumiIds(query, 5, STALE_AFTER_SECONDS);
    expect(stale).toHaveLength(5);
    expect(stale[0]).toBe("stale-8d");
    expect(stale).not.toContain("still-fresh");
  });
});

databaseDescribe("listStaleBangumiIds freshness floor", () => {
  beforeAll(async () => {
    await truncate();
    await insertRaw("raw_anitabi", "fresh-a", ONE_HOUR);
    await insertRaw("raw_bangumi", "fresh-a", ONE_HOUR);
    await insertRaw("raw_anitabi", "fresh-b", ONE_HOUR);
    await insertRaw("raw_bangumi", "fresh-b", ONE_HOUR);
  }, 60_000);

  it("returns nothing when every work is fresh — no perpetual treadmill", async () => {
    await expect(listStaleBangumiIds(query, 5, STALE_AFTER_SECONDS)).resolves.toEqual([]);
  });
});

databaseDescribe("listDrainableBangumiIds running-claim scope", () => {
  beforeAll(async () => {
    await truncate();
    await pool.query(`
      INSERT INTO ingest_jobs (work_id, status, started_at, negative_cached_until)
      VALUES ('drain-running-fresh', 'running', NOW(), NOW() - INTERVAL '1 second')
    `);
  }, 60_000);

  it("excludes a running row whose heartbeat is fresh, even with a lapsed negative cache", async () => {
    // The failed-status cache arm must stay scoped to status = 'failed': an
    // ungrouped OR would let the lapsed cache drain an in-flight claim.
    const drainable = await listDrainableBangumiIds(query, 10);
    expect(drainable).not.toContain("drain-running-fresh");
  });
});
