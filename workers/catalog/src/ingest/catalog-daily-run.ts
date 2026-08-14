/**
 * Production composition of the daily discovery + ingest run (#1006).
 *
 * Wires the run protocol (daily-run.ts) to the CatalogDb seam: run persistence
 * over catalog_runs (run-store.ts), per-work ingest with provenance + raw-history
 * capture (run-ingest.ts), and bounded raw-history cleanup (raw_history.ts). The
 * caller supplies the epoch clock and the discovery inputs + known/tiered works
 * so the scheduled handler owns upstream discovery while the run owns the
 * durable protocol.
 */
import { dailyRunKey, type DiscoveryInput } from "./discovery";
import { runDailyIngestWith, type RunPlan, type RunPolicy, type RunPorts } from "./daily-run";
import type { DailyRunOutcome } from "../publish/daily-snapshot";
import type { TieredWork } from "./tiers";
import { beginRunRow, markRunFailedRow, readRunRow, recordRunRow } from "./run-store";
import { cleanupRawHistory } from "./raw_history";
import { ingestRunWork } from "./run-ingest";
import type { CatalogDb } from "../db/client";

/** Inputs the scheduled handler resolves before the run starts. */
export interface DailyRunInputs {
  discovery: readonly DiscoveryInput[];
  knownIds: ReadonlySet<string>;
  tiered: readonly TieredWork[];
}

/** Run the daily ingest for `epochMs`; returns the run outcome (id + createdAt) so the published snapshot matches the run that produced it (issue #1012). */
export async function catalogDailyRun(
  db: CatalogDb,
  epochMs: number,
  inputs: DailyRunInputs,
  policy: RunPolicy,
): Promise<DailyRunOutcome> {
  const runId = dailyRunKey(epochMs);
  const plan: RunPlan = { runId, epochMs, discovery: inputs.discovery, knownIds: inputs.knownIds, tiered: inputs.tiered, policy };
  const run = await runDailyIngestWith(catalogPorts(db, runId, policy.keepHistory), plan);
  return { status: run.status, runId, createdAt: new Date(epochMs).toISOString() };
}

/** The RunPorts bound to a CatalogDb for one run id. */
export function catalogPorts(db: CatalogDb, runId: string, keepHistory: number): RunPorts {
  return {
    readRun: (id) => readRunRow(db, id),
    beginRun: (id) => beginRunRow(db, id),
    recordRun: (id, snapshot) => recordRunRow(db, id, snapshot),
    ingestWork: (bangumiId, tier, budget) => ingestRunWork(db, bangumiId, runId, budget),
    cleanup: (id) => cleanupRawHistory(db, id, keepHistory),
    markRunFailed: (id, reason) => markRunFailedRow(db, id, reason),
  };
}
