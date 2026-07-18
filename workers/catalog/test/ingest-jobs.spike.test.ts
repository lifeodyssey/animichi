import { afterAll, beforeAll, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import type { CatalogDb } from "../src/db/client";
import { JobStore } from "../src/ingest/jobs";
import { saveRawAnitabi, saveRawBangumi } from "../src/ingest/raw-store";
import {
  databaseDescribe,
  openServerlessDb,
  restoreNeonConfig,
  truncateCatalog,
} from "./spike-db";

/**
 * Spike for the ingest data layer (card W1-6): JobStore singleflight +
 * negative cache over `ingest_jobs`, and the raw-zone UPSERT round-trip into
 * `raw_anitabi` / `raw_bangumi`.
 *
 * Uses the full Atlas schema inherited by the suite branch, then drives the
 * writers through Neon Local's proven serverless-HTTP path.
 */

let db: CatalogDb;

async function statusOf(workId: string): Promise<string | undefined> {
  const rows = (
    await db.execute(sql`SELECT status FROM ingest_jobs WHERE work_id = ${workId}`)
  ).rows as { status: string }[];
  return rows[0]?.status;
}

async function runningCount(workId: string): Promise<number> {
  const rows = (
    await db.execute(
      sql`SELECT COUNT(*)::int AS n FROM ingest_jobs WHERE work_id = ${workId} AND status = 'running'`,
    )
  ).rows as { n: number }[];
  return rows[0]?.n ?? 0;
}

async function backdateNegativeCache(workId: string): Promise<void> {
  await db.execute(
    sql`UPDATE ingest_jobs SET negative_cached_until = NOW() - INTERVAL '1 second' WHERE work_id = ${workId}`,
  );
}

beforeAll(async () => {
  db = await openServerlessDb();
  await truncateCatalog(db);
}, 120_000);

afterAll(restoreNeonConfig);

databaseDescribe("JobStore singleflight over ingest_jobs", () => {
  it("lets exactly one of 20 concurrent acquirers win, leaving one running row", async () => {
    const results = await Promise.all(
      Array.from({ length: 20 }, () => new JobStore(db).acquire("race-1")),
    );
    expect(results.filter((won) => won)).toHaveLength(1);
    expect(await runningCount("race-1")).toBe(1);
  });

  it("markDone flips status to done", async () => {
    const store = new JobStore(db);
    await store.acquire("done-1");
    await store.markDone("done-1");
    expect(await statusOf("done-1")).toBe("done");
  });

  it("reclaims only stale running work and picks exactly one concurrent winner", async () => {
    await db.execute(sql`
      INSERT INTO ingest_jobs (work_id, status, started_at)
      VALUES ('fresh-running', 'running', NOW()),
             ('stale-running', 'running', NOW() - INTERVAL '16 minutes')
    `);
    const fresh = await Promise.all([
      new JobStore(db).acquire("fresh-running"), new JobStore(db).acquire("fresh-running"),
    ]);
    const stale = await Promise.all([
      new JobStore(db).acquire("stale-running"), new JobStore(db).acquire("stale-running"),
    ]);
    expect(fresh).toEqual([false, false]);
    expect(stale.filter(Boolean)).toHaveLength(1);
  });
});

databaseDescribe("JobStore negative cache", () => {
  it("blocks re-acquire while negative_cached_until is in the future", async () => {
    const store = new JobStore(db);
    await store.acquire("neg-1");
    await store.markFailed("neg-1", { errorCode: "upstream_500", ttlSeconds: 3600 });
    expect(await store.acquire("neg-1")).toBe(false);
    expect(await statusOf("neg-1")).toBe("failed");
  });

  it("re-acquires once the failure's negative_cached_until TTL has elapsed", async () => {
    const store = new JobStore(db);
    await store.acquire("ttl-1");
    await store.markFailed("ttl-1", { errorCode: "upstream_500", ttlSeconds: 3600 });
    await backdateNegativeCache("ttl-1");
    expect(await store.acquire("ttl-1")).toBe(true);
    expect(await statusOf("ttl-1")).toBe("running");
  });
});

databaseDescribe("raw-store UPSERT round-trip", () => {
  it("saves and reads back an Anitabi payload, overwriting on re-save", async () => {
    await saveRawAnitabi(db, "raw-a", [{ id: "p1", name: "spot" }]);
    await saveRawAnitabi(db, "raw-a", [{ id: "p1", name: "renamed" }]);
    const rows = (
      await db.execute(sql`SELECT payload FROM raw_anitabi WHERE work_id = 'raw-a'`)
    ).rows as { payload: { name: string }[] }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]?.payload[0]?.name).toBe("renamed");
  });

  it("saves and reads back a Bangumi subject payload", async () => {
    await saveRawBangumi(db, "raw-b", { id: 1, name: "らき☆すた" });
    const rows = (
      await db.execute(sql`SELECT payload FROM raw_bangumi WHERE work_id = 'raw-b'`)
    ).rows as { payload: { name: string } }[];
    expect(rows[0]?.payload.name).toBe("らき☆すた");
  });
});
