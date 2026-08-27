import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import type { CatalogDb } from "../src/db/client";
import { JobStore } from "../src/ingest/jobs";
import { databaseDescribe, openServerlessDb, restoreNeonConfig, truncateCatalog } from "./spike-db";

/**
 * Guard/acquire time semantics against REAL Postgres (issue #1227): the
 * ambiguously named stale expression was pasted into both the acquire (asking
 * "can I steal this row") and the guard's running_live projection (asking the
 * negation, "is it still alive"), so a dead running row reported in_progress
 * forever and was never retried. A fake cannot testify about NOW()-interval
 * comparisons — these shapes must run on Postgres.
 */

let db: CatalogDb;
let jobs: JobStore;

const STALE_AGE = 45 * 60; // 45 min — three RUNNING_TTLs past dead
const FRESH_AGE = 60; // 1 min — well inside the TTL

async function insertRunningJob(workId: string, ageSeconds: number): Promise<void> {
  await db.execute(sql`
    INSERT INTO ingest_jobs (work_id, status, created_at, started_at)
    VALUES (${workId}, 'running',
      NOW() - make_interval(secs => ${ageSeconds}),
      NOW() - make_interval(secs => ${ageSeconds}))
  `);
}

async function insertFailedJob(workId: string, cachedForSeconds: number): Promise<void> {
  await db.execute(sql`
    INSERT INTO ingest_jobs (work_id, status, error_code, negative_cached_until)
    VALUES (${workId}, 'failed', 'upstream_error',
      NOW() + make_interval(secs => ${cachedForSeconds}))
  `);
}

beforeAll(async () => {
  db = await openServerlessDb();
  jobs = new JobStore(db);
}, 120_000);

beforeEach(async () => {
  await truncateCatalog(db);
});

afterAll(() => { restoreNeonConfig(); });

databaseDescribe("singleflight guard vs abandoned running rows (#1227)", () => {
  it("reports a fresh running row as in_progress and refuses the acquire", async () => {
    await insertRunningJob("w1", FRESH_AGE);
    expect(await jobs.guard("w1")).toBe("in_progress");
    expect(await jobs.acquire("w1")).toBe(false);
  });

  it("reports a dead running row as ready and lets the acquire steal it", async () => {
    await insertRunningJob("w1", STALE_AGE);
    expect(await jobs.guard("w1")).toBe("ready");
    expect(await jobs.acquire("w1")).toBe(true);
  });

  it("restarts the heartbeat when stealing, so the thief holds the flight", async () => {
    await insertRunningJob("w1", STALE_AGE);
    expect(await jobs.acquire("w1")).toBe(true);
    expect(await jobs.guard("w1")).toBe("in_progress");
    expect(await jobs.acquire("w1")).toBe(false);
  });

  it("parks a failure behind its negative cache, then frees it", async () => {
    await insertFailedJob("w1", 3600);
    expect(await jobs.guard("w1")).toBe("recently_attempted");
    expect(await jobs.acquire("w1")).toBe(false);
    await insertFailedJob("w2", -1);
    expect(await jobs.guard("w2")).toBe("ready");
    expect(await jobs.acquire("w2")).toBe(true);
  });
});
