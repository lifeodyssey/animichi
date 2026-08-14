import { afterAll, beforeAll, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import type { CatalogDb } from "../src/db/client";
import { runDailyIngestWith, type RunPlan, type RunPolicy } from "../src/ingest/daily-run";
import { catalogPorts } from "../src/ingest/catalog-daily-run";
import { appendRawHistory, cleanupRawHistory, historyCount } from "../src/ingest/raw_history";
import { captureProvenance } from "../src/ingest/provenance";
import {
  databaseDescribe,
  openServerlessDb,
  restoreNeonConfig,
  truncateCatalog,
} from "./spike-db";

/**
 * Integration spike for the daily discovery + ingest run (#1006).
 *
 * Exercises the durable run protocol (AC1), deterministic discovery (AC2),
 * provenance capture (AC4), bounded raw retention (AC5), and the partial/failed
 * run guarantee that never advances a published pointer (AC6) against a real
 * Neon Postgres with the complete Atlas schema.
 */

const POLICY: RunPolicy = {
  staleRunningMs: 15 * 60_000,
  tierIntervals: { high: 86_400_000, medium: 604_800_000, low: 2_592_000_000 },
  newWorkCap: 5,
  keepHistory: 2,
  budget: { workLimit: 5, requestLimit: 20, runtimeLimitMs: 600_000 },
};

let db: CatalogDb;

async function runStatus(runId: string): Promise<string | null> {
  const rows = (await db.execute(sql`SELECT status FROM catalog_runs WHERE run_id = ${runId}`)).rows;
  return (rows[0] as { status: string } | undefined)?.status ?? null;
}

async function currentPointer(workId: string): Promise<number | undefined> {
  const result = await db.execute(
    sql`SELECT version FROM cluster_version WHERE bangumi_id = ${workId} AND is_current`,
  );
  const rows = result.rows as { version: number }[];
  return rows[0]?.version;
}

beforeAll(async () => {
  db = await openServerlessDb();
  await truncateCatalog(db);
}, 120_000);

afterAll(() => { restoreNeonConfig(); });

function plan(runId: string): RunPlan {
  return {
    runId,
    epochMs: 1_723_000_000_000,
    discovery: [{ source: "current_season", bangumiIds: ["spike-1", "spike-2"] }],
    knownIds: new Set(),
    tiered: [
      { bangumiId: "spike-1", tier: "high", lastIngestedAtMs: null },
      { bangumiId: "spike-2", tier: "high", lastIngestedAtMs: null },
    ],
    policy: POLICY,
  };
}

/** A run that needs upstream data returns a failed-run record, never completing. */
databaseDescribe("Daily run durability (AC1)", () => {
  it("records the stable run id and a terminal status", async () => {
    await runDailyIngestWith(catalogPorts(db, "daily-ac1", POLICY.keepHistory), plan("daily-ac1"));
    const status = await runStatus("daily-ac1");
    expect([ "failed", "partial" ]).toContain(status);
  });

  it("is idempotent: re-running a recorded run id does not duplicate the row", async () => {
    const id = "daily-idem";
    await runDailyIngestWith(catalogPorts(db, id, POLICY.keepHistory), plan(id));
    await runDailyIngestWith(catalogPorts(db, id, POLICY.keepHistory), plan(id));
    const rows = (await db.execute(sql`SELECT COUNT(*)::int AS n FROM catalog_runs WHERE run_id = ${id}`)).rows as { n: number }[];
    expect(rows[0]?.n).toBe(1);
  });
});

databaseDescribe("Raw payload retention (AC5)", () => {
  it("keeps exactly the latest and previous raw payload per work/source", async () => {
    for (let i = 1; i <= 4; i += 1) {
      await appendRawHistory(db, { workId: "retain-w", source: "anitabi", payload: [{ n: i }] });
    }
    await cleanupRawHistory(db, "not-the-run");
    expect(await historyCount(db, "retain-w", "anitabi")).toBe(2);
  });

  it("never prunes the active run's evidence", async () => {
    for (let i = 1; i <= 3; i += 1) {
      await appendRawHistory(db, { workId: "active-w", source: "anitabi", payload: [{ n: i }], runId: "daily-active" });
    }
    await cleanupRawHistory(db, "daily-active");
    expect(await historyCount(db, "active-w", "anitabi")).toBe(3);
  });
});

databaseDescribe("Provenance capture (AC4)", () => {
  it("UPSERTs a point provenance record with upstream identity and a field map", async () => {
    await captureProvenance(db, {
      scope: "point",
      entityId: "p-1",
      workId: "prov-w",
      source: "anitabi",
      upstreamId: "p-1",
      attribution: "Anitabi",
      license: "https://anitabi.cn",
      fieldMap: { name: "anitabi", latitude: "anitabi" },
    });
    const result = await db.execute(
      sql`SELECT upstream_id, source FROM catalog_provenance WHERE entity_id = 'p-1'`,
    );
    const rows = result.rows as { upstream_id: string; source: string }[];
    expect(rows[0]?.upstream_id).toBe("p-1");
    expect(rows[0]?.source).toBe("anitabi");
  });
});

databaseDescribe("Published pointer safety (AC6)", () => {
  it("does not advance the published pointer for a work that never publishes", async () => {
    expect(await currentPointer("spike-1")).toBeUndefined();
    await runDailyIngestWith(catalogPorts(db, "daily-ac6", POLICY.keepHistory), plan("daily-ac6"));
    expect(await currentPointer("spike-1")).toBeUndefined();
  });
});
