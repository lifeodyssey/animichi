import pg from "pg";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import type { CatalogPrisma } from "../src/db/prisma";
import {
  runDailyIngestWith, type RunPlan, type RunPolicy, type RunPorts, type RunWorkOutcome,
} from "../src/ingest/daily-run";
import { catalogPorts } from "../src/ingest/catalog-daily-run";
import { appendRawHistory, cleanupRawHistory, historyCount } from "../src/ingest/raw-history";
import { captureProvenance } from "../src/ingest/provenance";
import {
  databaseDescribe,
  openPlaneSeams,
  truncateCatalogPool,
  type PlaneSeams,
} from "./integration-db";

/**
 * Integration suite for the daily discovery + ingest run (#1006).
 *
 * Exercises the durable run protocol (AC1), deterministic discovery (AC2),
 * provenance capture (AC4), bounded raw retention (AC5), the partial/failed
 * run guarantee that never marks a failed work published (AC6), and the failure
 * ledger a retry carries forward, against the committed Prisma chain's schema,
 * cloned into the suite database.
 */

const POLICY: RunPolicy = {
  staleRunningMs: 15 * 60_000,
  tierIntervals: { high: 86_400_000, medium: 604_800_000, low: 2_592_000_000 },
  newWorkCap: 5,
  keepHistory: 2,
  budget: { workLimit: 5, requestLimit: 20 },
};

let pool: pg.Pool;
let query: CatalogPrisma;
let seams: PlaneSeams;

async function runStatus(runId: string): Promise<string | null> {
  const { rows } = await pool.query("SELECT status FROM catalog_runs WHERE run_id = $1", [runId]);
  return (rows[0] as { status: string } | undefined)?.status ?? null;
}

async function publishTrace(runId: string, workId: string): Promise<Record<string, unknown> | undefined> {
  const sql = "SELECT EXISTS (SELECT 1 FROM bangumi WHERE id = $2) AS bangumi, EXISTS (SELECT 1 FROM catalog_runs"
    + " WHERE run_id = $1 AND published_versions ? $2) AS published";
  return (await pool.query<Record<string, unknown>>(sql, [runId, workId])).rows[0];
}

beforeAll(async () => {
  seams = await openPlaneSeams();
  pool = seams.pool;
  query = seams.query;
  await truncateCatalogPool(pool);
}, 120_000);

afterAll(async () => {
  await seams.dispose();
});

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
    await runDailyIngestWith(catalogPorts(query, "daily-ac1", POLICY.keepHistory), plan("daily-ac1"));
    const status = await runStatus("daily-ac1");
    expect([ "failed", "partial" ]).toContain(status);
  });

  it("is idempotent: re-running a recorded run id does not duplicate the row", async () => {
    const id = "daily-idem";
    await runDailyIngestWith(catalogPorts(query, id, POLICY.keepHistory), plan(id));
    await runDailyIngestWith(catalogPorts(query, id, POLICY.keepHistory), plan(id));
    const { rows } = await pool.query<{ n: number }>(
      "SELECT COUNT(*)::int AS n FROM catalog_runs WHERE run_id = $1", [id],
    );
    expect(rows[0]?.n).toBe(1);
  });
});

databaseDescribe("Raw payload retention (AC5)", () => {
  it("keeps exactly the latest and previous raw payload per work/source", async () => {
    for (let i = 1; i <= 4; i += 1) {
      await appendRawHistory(query, { workId: "retain-w", source: "anitabi", payload: [{ n: i }] });
    }
    await cleanupRawHistory(query, "not-the-run");
    expect(await historyCount(query, "retain-w", "anitabi")).toBe(2);
  });

  it("never prunes the active run's evidence", async () => {
    for (let i = 1; i <= 3; i += 1) {
      await appendRawHistory(query, { workId: "active-w", source: "anitabi", payload: [{ n: i }], runId: "daily-active" });
    }
    await cleanupRawHistory(query, "daily-active");
    expect(await historyCount(query, "active-w", "anitabi")).toBe(3);
  });
});

databaseDescribe("Provenance capture (AC4)", () => {
  it("UPSERTs a point provenance record with upstream identity and a field map", async () => {
    await captureProvenance(query, [{
      scope: "point",
      entityId: "p-1",
      workId: "prov-w",
      source: "anitabi",
      upstreamId: "p-1",
      attribution: "Anitabi",
      license: "https://anitabi.cn",
      fieldMap: { name: "anitabi", latitude: "anitabi" },
    }]);
    const { rows: provenance } = await pool.query(
      "SELECT upstream_id, source FROM catalog_provenance WHERE entity_id = 'p-1'",
    );
    const rows = provenance as { upstream_id: string; source: string }[];
    expect(rows[0]?.upstream_id).toBe("p-1");
    expect(rows[0]?.source).toBe("anitabi");
  });
});

databaseDescribe("Publish safety for a failed work (AC6)", () => {
  it("leaves no catalog row and no published marker for a work that never publishes", async () => {
    expect(await publishTrace("daily-ac6", "spike-1")).toEqual({ bangumi: false, published: false });
    await runDailyIngestWith(catalogPorts(query, "daily-ac6", POLICY.keepHistory), plan("daily-ac6"));
    expect(await publishTrace("daily-ac6", "spike-1")).toEqual({ bangumi: false, published: false });
  });
});

const INGESTED: RunWorkOutcome = { outcome: "ingested" };
const SPIKE_2_FAILED = { bangumiId: "spike-2", stage: "enrich", reason: "boom" };
const RECLAIMED = { stage: "reclaim", reason: "stale-reclaimed" };

/** The real run store, with each work's ingest scripted so a failure needs no upstream. */
function scriptedPorts(runId: string, ingestWork: RunPorts["ingestWork"]): RunPorts {
  return { ...catalogPorts(query, runId, POLICY.keepHistory), ingestWork };
}

/** A first attempt in which spike-1 publishes and spike-2 fails at enrich. */
async function partialFirstAttempt(runId: string): Promise<void> {
  const ingestWork = vi.fn<RunPorts["ingestWork"]>()
    .mockResolvedValueOnce(INGESTED)
    .mockResolvedValueOnce({ outcome: "pipelineFailed", stage: "enrich", reason: "boom" });
  await runDailyIngestWith(scriptedPorts(runId, ingestWork), plan(runId));
}

/** A retry in which every remaining work publishes. */
async function succeedingRetry(runId: string): Promise<void> {
  const ingestWork = vi.fn<RunPorts["ingestWork"]>().mockResolvedValue(INGESTED);
  await runDailyIngestWith(scriptedPorts(runId, ingestWork), plan(runId));
}

/** Leave the run as an attempt that started long before the plan's clock and never finished. */
async function abandonAttempt(runId: string): Promise<void> {
  await pool.query(
    "UPDATE catalog_runs SET status = 'running', started_at = '2024-08-06T00:00:00Z' WHERE run_id = $1", [runId],
  );
}

async function ledgerOf(runId: string): Promise<unknown> {
  const { rows } = await pool.query("SELECT failures FROM catalog_runs WHERE run_id = $1", [runId]);
  return (rows[0] as { failures: unknown } | undefined)?.failures;
}

databaseDescribe("Failure ledger across attempts", () => {
  it("a resumed run keeps the failure its first attempt recorded, and completes", async () => {
    await partialFirstAttempt("daily-ledger-resume");
    await succeedingRetry("daily-ledger-resume");
    expect(await runStatus("daily-ledger-resume")).toBe("complete");
    expect(await ledgerOf("daily-ledger-resume")).toEqual([SPIKE_2_FAILED]);
  });

  it("a stale reclaim keeps the earlier failure and appends a reclaim entry naming no work", async () => {
    await partialFirstAttempt("daily-ledger-stale");
    await abandonAttempt("daily-ledger-stale");
    await succeedingRetry("daily-ledger-stale");
    expect(await ledgerOf("daily-ledger-stale")).toEqual([SPIKE_2_FAILED, RECLAIMED]);
  });

  it("keeps the reclaim on the row when the reclaiming attempt dies before it records", async () => {
    await partialFirstAttempt("daily-ledger-died");
    await abandonAttempt("daily-ledger-died");
    const dies = vi.fn<RunPorts["ingestWork"]>().mockRejectedValue(new Error("worker evicted"));
    await expect(runDailyIngestWith(scriptedPorts("daily-ledger-died", dies), plan("daily-ledger-died")))
      .rejects.toThrow("worker evicted");
    expect(await ledgerOf("daily-ledger-died")).toEqual([SPIKE_2_FAILED, RECLAIMED]);
  });
});
