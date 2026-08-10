import { afterAll, beforeAll, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import type { CatalogDb } from "../src/db/client";
import { listStaleBangumiIds, STALE_AFTER_SECONDS } from "../src/ingest/cron-queries";
import { databaseDescribe, openServerlessDb, restoreNeonConfig, truncateCatalog } from "./spike-db";

/**
 * Spike for the cron staleness query (S0-v2 D4 fix round): the three staleness
 * shapes against REAL Postgres — both sources fresh, one source stale, one
 * source entirely absent — plus the negative-cache exclusion, the batch cap,
 * and the TTL freshness floor. `MAX`/UNION regressions fail here.
 */

let db: CatalogDb;

const ONE_HOUR = 60 * 60;
const TWO_DAYS = 2 * 24 * 60 * 60;

async function insertRaw(
  table: "raw_anitabi" | "raw_bangumi",
  workId: string,
  ageSeconds: number,
): Promise<void> {
  await db.execute(sql`
    INSERT INTO ${sql.raw(table)} (work_id, payload, fetched_at)
    VALUES (${workId}, '{}'::jsonb, NOW() - make_interval(secs => ${ageSeconds}))
  `);
}

async function insertNegativeCache(workId: string, secondsFromNow: number): Promise<void> {
  await db.execute(sql`
    INSERT INTO ingest_jobs (work_id, status, negative_cached_until)
    VALUES (${workId}, 'failed', NOW() + make_interval(secs => ${secondsFromNow}))
  `);
}

beforeAll(async () => {
  db = await openServerlessDb();
  await truncateCatalog(db);
}, 120_000);

afterAll(() => { restoreNeonConfig(); });

databaseDescribe("listStaleBangumiIds staleness shapes", () => {
  beforeAll(async () => {
    await truncateCatalog(db);
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
    const stale = await listStaleBangumiIds(db, 10, STALE_AFTER_SECONDS);
    expect(stale).not.toContain("both-fresh");
  });

  it("selects a work when ONE source is stale, even if the other is fresh", async () => {
    const stale = await listStaleBangumiIds(db, 10, STALE_AFTER_SECONDS);
    expect(stale).toContain("one-stale");
  });

  it("selects a work when ONE source row is entirely absent", async () => {
    const stale = await listStaleBangumiIds(db, 10, STALE_AFTER_SECONDS);
    expect(stale).toContain("missing-source");
  });

  it("skips works behind a live failure negative-cache", async () => {
    const stale = await listStaleBangumiIds(db, 10, STALE_AFTER_SECONDS);
    expect(stale).not.toContain("neg-cached");
  });

  it("re-admits a failed work once its negative-cache has lapsed", async () => {
    const stale = await listStaleBangumiIds(db, 10, STALE_AFTER_SECONDS);
    expect(stale).toContain("cache-lapsed");
  });
});

databaseDescribe("listStaleBangumiIds batch cap and freshness floor", () => {
  beforeAll(async () => {
    await truncateCatalog(db);
    for (let days = 2; days <= 8; days += 1) {
      await insertRaw("raw_anitabi", "stale-" + String(days) + "d", days * 24 * 60 * 60);
      await insertRaw("raw_bangumi", "stale-" + String(days) + "d", days * 24 * 60 * 60);
    }
    await insertRaw("raw_anitabi", "still-fresh", ONE_HOUR);
    await insertRaw("raw_bangumi", "still-fresh", ONE_HOUR);
  }, 60_000);

  it("returns at most the cap, oldest-first, excluding fresh works", async () => {
    const stale = await listStaleBangumiIds(db, 5, STALE_AFTER_SECONDS);
    expect(stale).toHaveLength(5);
    expect(stale[0]).toBe("stale-8d");
    expect(stale).not.toContain("still-fresh");
  });
});

databaseDescribe("listStaleBangumiIds freshness floor", () => {
  beforeAll(async () => {
    await truncateCatalog(db);
    await insertRaw("raw_anitabi", "fresh-a", ONE_HOUR);
    await insertRaw("raw_bangumi", "fresh-a", ONE_HOUR);
    await insertRaw("raw_anitabi", "fresh-b", ONE_HOUR);
    await insertRaw("raw_bangumi", "fresh-b", ONE_HOUR);
  }, 60_000);

  it("returns nothing when every work is fresh — no perpetual treadmill", async () => {
    await expect(listStaleBangumiIds(db, 5, STALE_AFTER_SECONDS)).resolves.toEqual([]);
  });
});
