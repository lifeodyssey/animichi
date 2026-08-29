import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { eq, sql, type SQL } from "drizzle-orm";
import type { CatalogDb } from "../src/db/client";
import { statementBuilder } from "../src/db/client";
import { ingestJobs } from "../src/db/schema";
import { JobStore } from "../src/ingest/jobs";
import { listDrainableBangumiIds } from "../src/ingest/cron-queries";
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

function secondsAgo(seconds: number) {
  return sql`NOW() - make_interval(secs => ${seconds})`;
}

async function insertRunningJob(workId: string, ageSeconds: number): Promise<void> {
  const statement = statementBuilder()
    .insert(ingestJobs)
    .values({ workId, status: "running", createdAt: secondsAgo(ageSeconds), startedAt: secondsAgo(ageSeconds) })
    .getSQL();
  await db.execute(statement);
}

async function insertFailedJob(workId: string, cachedForSeconds: number): Promise<void> {
  const statement = statementBuilder()
    .insert(ingestJobs)
    .values({
      workId, status: "failed", errorCode: "upstream_error",
      negativeCachedUntil: secondsAgo(-cachedForSeconds),
    })
    .getSQL();
  await db.execute(statement);
}

function statusStatement(workId: string): SQL {
  return statementBuilder()
    .select({ status: ingestJobs.status })
    .from(ingestJobs)
    .where(eq(ingestJobs.workId, workId))
    .getSQL();
}

async function jobStatus(workId: string): Promise<string | undefined> {
  const rows = (await db.execute(statusStatement(workId))).rows as { status: string }[];
  return rows[0]?.status;
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

databaseDescribe("pending drain eligibility (#1229)", () => {
  it("does not park a fresh running claim", async () => {
    await insertRunningJob("fresh-running", FRESH_AGE);
    await jobs.ensurePending("fresh-running");
    expect(await jobStatus("fresh-running")).toBe("running");
    expect(await jobs.guard("fresh-running")).toBe("in_progress");
  });

  it("does not overwrite a live negative cache", async () => {
    await insertFailedJob("cached-failure", 3600);
    await jobs.ensurePending("cached-failure");
    expect(await jobStatus("cached-failure")).toBe("failed");
    expect(await jobs.guard("cached-failure")).toBe("recently_attempted");
  });

  it("parks an abandoned running claim", async () => {
    await insertRunningJob("stale-running", STALE_AGE);
    await jobs.ensurePending("stale-running");
    expect(await jobStatus("stale-running")).toBe("pending");
  });

  it("parks a failure after its negative cache expires", async () => {
    await insertFailedJob("retryable-failure", -1);
    await jobs.ensurePending("retryable-failure");
    expect(await jobStatus("retryable-failure")).toBe("pending");
  });

  it("includes stale running work but fences a fresh running claim", async () => {
    await insertRunningJob("stale-running", STALE_AGE);
    await insertRunningJob("fresh-running", FRESH_AGE);

    const drainable = await listDrainableBangumiIds(db, 10);

    expect(drainable).toContain("stale-running");
    expect(drainable).not.toContain("fresh-running");
  });

  it("retries a failed work only after its negative cache expires", async () => {
    await insertFailedJob("cached-failure", 3600);
    await insertFailedJob("retryable-failure", -1);

    const drainable = await listDrainableBangumiIds(db, 10);

    expect(drainable).not.toContain("cached-failure");
    expect(drainable).toContain("retryable-failure");
  });
});
