import { afterAll, beforeAll, expect, it } from "vitest";
import type pg from "pg";
import type { CatalogPrisma } from "../src/db/prisma";
import { JobStore } from "../src/ingest/jobs";
import { saveRawAnitabi, saveRawBangumi } from "../src/ingest/raw-store";
import {
  catalogTruncateSql,
  databaseDescribe,
  openPlanePrisma,
  planePool,
  restoreNeonConfig,
  type PlanePrisma,
} from "./integration-db";

/**
 * Integration suite for the ingest data layer (card W1-6): JobStore singleflight +
 * negative cache over `ingest_jobs`, and the raw-zone UPSERT round-trip into
 * `raw_anitabi` / `raw_bangumi`.
 *
 * The writers are builder plans over the shared contract, run on the suite's
 * Prisma plane (#1630), so what is proved here is the plans' own semantics —
 * including the guarded claim's UPDATE-then-INSERT pair, whose single-winner
 * property comes from the unique key rather than from a conflict predicate. The
 * rows those plans are checked against are read with a plain pool: an assertion
 * about what landed should not go back through the seam it is checking.
 */

let seams: PlanePrisma;
let query: CatalogPrisma;
let pool: pg.Pool;

async function statusOf(workId: string): Promise<string | undefined> {
  const { rows } = await pool.query<{ status: string }>(
    "SELECT status FROM ingest_jobs WHERE work_id = $1", [workId],
  );
  return rows[0]?.status;
}

async function runningCount(workId: string): Promise<number> {
  const { rows } = await pool.query<{ n: number }>(
    "SELECT COUNT(*)::int AS n FROM ingest_jobs WHERE work_id = $1 AND status = 'running'", [workId],
  );
  return rows[0]?.n ?? 0;
}

async function backdateNegativeCache(workId: string): Promise<void> {
  await pool.query(
    "UPDATE ingest_jobs SET negative_cached_until = NOW() - INTERVAL '1 second' WHERE work_id = $1", [workId],
  );
}

beforeAll(async () => {
  seams = await openPlanePrisma();
  query = seams.query;
  pool = planePool();
  await pool.query(catalogTruncateSql());
}, 120_000);

afterAll(async () => {
  await seams.dispose();
  restoreNeonConfig();
});

databaseDescribe("JobStore singleflight over ingest_jobs", () => {
  it("lets exactly one of 20 concurrent acquirers win, leaving one running row", async () => {
    const results = await Promise.all(
      Array.from({ length: 20 }, () => new JobStore(query).acquire("race-1")),
    );
    expect(results.filter((won) => won)).toHaveLength(1);
    expect(await runningCount("race-1")).toBe(1);
  });

  it("markDone flips status to done", async () => {
    const store = new JobStore(query);
    await store.acquire("done-1");
    await store.markDone("done-1");
    expect(await statusOf("done-1")).toBe("done");
  });

  it("reclaims only stale running work and picks exactly one concurrent winner", async () => {
    await pool.query(`
      INSERT INTO ingest_jobs (work_id, status, started_at)
      VALUES ('fresh-running', 'running', NOW()),
             ('stale-running', 'running', NOW() - INTERVAL '16 minutes')
    `);
    const fresh = await Promise.all([
      new JobStore(query).acquire("fresh-running"), new JobStore(query).acquire("fresh-running"),
    ]);
    const stale = await Promise.all([
      new JobStore(query).acquire("stale-running"), new JobStore(query).acquire("stale-running"),
    ]);
    expect(fresh).toEqual([false, false]);
    expect(stale.filter(Boolean)).toHaveLength(1);
  });

  it("does not reclaim a running row whose expired negative cache alone would match", async () => {
    // A re-claim after a lapsed TTL leaves negative_cached_until in the past,
    // so the claim's cache arm must be scoped to the not-running branch: an
    // ungrouped OR would let the expired cache match the running row itself.
    await pool.query(`
      INSERT INTO ingest_jobs (work_id, status, started_at, negative_cached_until)
      VALUES ('running-expired-cache', 'running', NOW(), NOW() - INTERVAL '1 second')
    `);

    expect(await new JobStore(query).acquire("running-expired-cache")).toBe(false);
    expect(await runningCount("running-expired-cache")).toBe(1);
  });
});

databaseDescribe("JobStore negative cache", () => {
  it("blocks re-acquire while negative_cached_until is in the future", async () => {
    const store = new JobStore(query);
    await store.acquire("neg-1");
    await store.markFailed("neg-1", { errorCode: "upstream_500", ttlSeconds: 3600 });
    expect(await store.acquire("neg-1")).toBe(false);
    expect(await statusOf("neg-1")).toBe("failed");
  });

  it("re-acquires once the failure's negative_cached_until TTL has elapsed", async () => {
    const store = new JobStore(query);
    await store.acquire("ttl-1");
    await store.markFailed("ttl-1", { errorCode: "upstream_500", ttlSeconds: 3600 });
    await backdateNegativeCache("ttl-1");
    expect(await store.acquire("ttl-1")).toBe(true);
    expect(await statusOf("ttl-1")).toBe("running");
  });
});

databaseDescribe("raw-store UPSERT round-trip", () => {
  it("saves and reads back an Anitabi payload, overwriting on re-save", async () => {
    await saveRawAnitabi(query, "raw-a", [{ id: "p1", name: "spot" }]);
    await saveRawAnitabi(query, "raw-a", [{ id: "p1", name: "renamed" }]);
    const { rows } = await pool.query<{ payload: { name: string }[] }>(
      "SELECT payload FROM raw_anitabi WHERE work_id = 'raw-a'",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.payload[0]?.name).toBe("renamed");
  });

  it("saves and reads back a Bangumi subject payload", async () => {
    await saveRawBangumi(query, "raw-b", { id: 1, name: "らき☆すた" });
    const { rows } = await pool.query<{ payload: { name: string } }>(
      "SELECT payload FROM raw_bangumi WHERE work_id = 'raw-b'",
    );
    expect(rows[0]?.payload.name).toBe("らき☆すた");
  });
});
