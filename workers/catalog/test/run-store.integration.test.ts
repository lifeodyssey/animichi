import { afterAll, beforeAll, expect, it } from "vitest";
import { catalogPorts } from "../src/ingest/catalog-daily-run";
import { runDailyIngestWith, type RunPlan, type RunPolicy, type RunPorts, type RunSnapshot } from "../src/ingest/daily-run";
import { UNRECOGNISED_LEDGER_ELEMENTS } from "./fixtures/unrecognised-ledger-elements";
import { databaseDescribe, openPlaneSeams, truncateCatalogPool, type PlaneSeams } from "./integration-db";

/**
 * The run store (`src/ingest/run-store.ts`) against the committed Prisma chain's
 * schema: a retried daily run writes back every element of the failure ledger
 * that the store does not recognise as the value it read (compared as jsonb
 * values, which keep no key order or whitespace; the fixtures hold no number a
 * JavaScript round trip would change). Both ledger writes are
 * covered — the resumed attempt's record, and the mark a stale reclaim leaves
 * when its attempt dies before it records — and a carried element never holds
 * the run's status back.
 */

const POLICY: RunPolicy = {
  staleRunningMs: 15 * 60_000,
  tierIntervals: { high: 86_400_000, medium: 604_800_000, low: 2_592_000_000 },
  newWorkCap: 5,
  keepHistory: 2,
  budget: { workLimit: 5, requestLimit: 20 },
};
const RECLAIMED = { stage: "reclaim", reason: "stale-reclaimed" };
const INGESTED: RunPorts["ingestWork"] = () => Promise.resolve({ outcome: "ingested" });
const EVICTED: RunPorts["ingestWork"] = () => Promise.reject(new Error("worker evicted"));

let seams: PlaneSeams;

beforeAll(async () => {
  seams = await openPlaneSeams();
  await truncateCatalogPool(seams.pool);
}, 120_000);

afterAll(async () => {
  await seams.dispose();
});

/** One due work, so an attempt whose ingest succeeds completes the run. */
function plan(runId: string): RunPlan {
  return {
    runId,
    epochMs: 1_723_000_000_000,
    discovery: [],
    knownIds: new Set(["store-w"]),
    tiered: [{ bangumiId: "store-w", tier: "high", lastIngestedAtMs: null }],
    policy: POLICY,
  };
}

/** The row an earlier attempt left: its status, a start long before the plan's clock, and its ledger. */
async function earlierAttempt(runId: string, status: "partial" | "running", ledger: readonly unknown[]): Promise<void> {
  await seams.pool.query(
    "INSERT INTO catalog_runs (run_id, status, started_at, failures) VALUES ($1, $2, '2024-08-06T00:00:00Z', $3::jsonb)",
    [runId, status, JSON.stringify(ledger)],
  );
}

/** Retry the run on the real store, with each work's ingest scripted so no upstream is needed. */
function retry(runId: string, ingestWork: RunPorts["ingestWork"]): Promise<RunSnapshot> {
  return runDailyIngestWith({ ...catalogPorts(seams.query, runId, POLICY.keepHistory), ingestWork }, plan(runId));
}

interface RecordedRun {
  status: string;
  failures: unknown;
}

async function recordedRun(runId: string): Promise<RecordedRun | undefined> {
  const { rows } = await seams.pool.query<RecordedRun>("SELECT status, failures FROM catalog_runs WHERE run_id = $1", [runId]);
  return rows[0];
}

databaseDescribe("A retry over a ledger element the store does not recognise", () => {
  it.each(UNRECOGNISED_LEDGER_ELEMENTS)("a resumed run writes back $label as the value it read, and completes", async ({ key, element }) => {
    await earlierAttempt(`store-resume-${key}`, "partial", [element]);

    await retry(`store-resume-${key}`, INGESTED);

    expect(await recordedRun(`store-resume-${key}`)).toEqual({ status: "complete", failures: [element] });
  });

  it.each(UNRECOGNISED_LEDGER_ELEMENTS)("a stale reclaim that dies before it records keeps $label ahead of the reclaim", async ({ key, element }) => {
    await earlierAttempt(`store-stale-${key}`, "running", [element]);

    await expect(retry(`store-stale-${key}`, EVICTED)).rejects.toThrow("worker evicted");

    expect((await recordedRun(`store-stale-${key}`))?.failures).toEqual([element, RECLAIMED]);
  });
});
