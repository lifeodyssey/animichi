import pg from "pg";
import { afterAll, beforeAll, expect, it } from "vitest";
import { enrichWork } from "../src/enrich/enrich";
import { saveRawAnitabi, saveRawBangumi } from "../src/ingest/raw-store";
import { enrichedRows } from "./enriched-rows";
import { LUCKY_STAR_ROWS, RAW_ANITABI, RAW_BANGUMI } from "./fixtures/lucky-star-enrich";
import {
  databaseDescribe,
  openPlanePrisma,
  openPlaneSeams,
  truncateCatalogPool,
  type PlanePrisma,
  type PlaneSeams,
} from "./integration-db";

/**
 * `enrichWork` under two overlapping first publishes of one work,
 * against the committed Prisma chain's schema cloned into the suite database:
 * both publishes commit, and the catalog holds exactly the rows one publish
 * writes.
 *
 * A publish's first write is the `bangumi` upsert. At READ COMMITTED the second
 * publish waits on that key until the first commits, and its `cluster_version`
 * swap then runs on the first's committed rows, so the swap is not what keeps
 * two publishes apart. This file holds that, before and after the swap goes.
 *
 * The publishes run on two runtimes, as two Worker requests do. One runtime is
 * one Postgres session (`postgresServerless().connect` opens one client, and
 * the driver queues each transaction behind the last), so two publishes on one
 * seam would only run one after the other. They overlap by construction rather
 * than by timing: a third session holds the work's key, an uncommitted insert of
 * the same `bangumi` id, and rolls it back once both publishes wait on a lock.
 */

const WORK = "lucky-star";

let pool: pg.Pool;
let seams: PlaneSeams;
let second: PlanePrisma;

beforeAll(async () => {
  seams = await openPlaneSeams();
  second = await openPlanePrisma();
  pool = seams.pool;
  await truncateCatalogPool(pool);
  await saveRawBangumi(seams.query, WORK, RAW_BANGUMI);
  await saveRawAnitabi(seams.query, WORK, RAW_ANITABI);
}, 120_000);

afterAll(async () => {
  await second.dispose();
  await seams.dispose();
});

/** How many sessions in this database are waiting on a lock. */
async function lockWaiters(): Promise<number> {
  const { rows } = await pool.query<{ n: number }>(
    "SELECT COUNT(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'",
  );
  return rows[0]?.n ?? 0;
}

async function awaitLockWaiters(count: number): Promise<void> {
  for (let i = 0; i < 500; i++) {
    if ((await lockWaiters()) >= count) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`fewer than ${String(count)} sessions ever waited on the work's key`);
}

/**
 * Start `publishes` while a third session holds the work's `bangumi` key, let
 * the key go once both wait on it, and settle them. The holder's connection is
 * destroyed rather than returned, so a failed wait never leaves its
 * transaction open on the pool.
 */
async function overlapOnKey(publishes: () => Promise<unknown>[]): Promise<PromiseSettledResult<unknown>[]> {
  const holder = await pool.connect();
  try {
    await holder.query("BEGIN");
    await holder.query("INSERT INTO bangumi (id, title) VALUES ($1, 'key holder')", [WORK]);
    const settled = Promise.allSettled(publishes());
    await awaitLockWaiters(2);
    await holder.query("ROLLBACK");
    return await settled;
  } finally {
    holder.release(true);
  }
}

databaseDescribe("enrichWork under two overlapping publishes of one work", () => {
  it("both commit, and the catalog holds the rows one publish writes", async () => {
    const settled = await overlapOnKey(() => [enrichWork(seams.query, WORK), enrichWork(second.query, WORK)]);

    expect(settled).toMatchObject([{ status: "fulfilled" }, { status: "fulfilled" }]);
    expect(await enrichedRows(pool, WORK)).toEqual(LUCKY_STAR_ROWS);
  });
});
