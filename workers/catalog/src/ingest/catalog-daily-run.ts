/**
 * Production composition of the daily discovery + ingest run (#1006).
 *
 * Wires the run protocol (daily-run.ts) to this request's Prisma runtime: run
 * persistence over catalog_runs (run-store.ts), per-work ingest with provenance
 * + raw-history capture (run-ingest.ts), and bounded raw-history cleanup
 * (raw_history.ts). The caller supplies the epoch clock and the discovery inputs
 * + known/tiered works so the scheduled handler owns upstream discovery while the
 * run owns the durable protocol.
 *
 * Every collaborator below is a plan over the shared contract, so the run takes
 * ONE seam — the request's {@link CatalogPrisma} — rather than a database handle
 * per module.
 */
import { dailyRunKey, type DiscoveryInput } from "./discovery";
import { runDailyIngestWith, type RunPlan, type RunPolicy, type RunPorts } from "./daily-run";
import type { DailyRunOutcome } from "../publish/daily-snapshot";
import type { TieredWork } from "./tiers";
import { beginRunRow, markRunFailedRow, readRunRow, recordRunRow } from "./run-store";
import { cleanupRawHistory } from "./raw_history";
import { ingestRunWork } from "./run-ingest";
import type { CatalogPrisma } from "../db/prisma";

/** Inputs the scheduled handler resolves before the run starts. */
export interface DailyRunInputs {
  discovery: readonly DiscoveryInput[];
  knownIds: ReadonlySet<string>;
  tiered: readonly TieredWork[];
}

/** Run the daily ingest for `epochMs`; returns the run outcome (id + createdAt) so the published snapshot matches the run that produced it (issue #1012). */
export async function catalogDailyRun(
  query: CatalogPrisma,
  epochMs: number,
  inputs: DailyRunInputs,
  policy: RunPolicy,
  egressSigningKey?: string,
): Promise<DailyRunOutcome> {
  const runId = dailyRunKey(epochMs);
  const plan: RunPlan = { runId, epochMs, discovery: inputs.discovery, knownIds: inputs.knownIds, tiered: inputs.tiered, policy };
  const run = await runDailyIngestWith(catalogPorts(query, runId, policy.keepHistory, egressSigningKey), plan);
  return { status: run.status, runId, createdAt: new Date(epochMs).toISOString() };
}

/** The RunPorts bound to one request's Prisma runtime for one run id (#1792: egress required for anitabi). */
export function catalogPorts(query: CatalogPrisma, runId: string, keepHistory: number, egressSigningKey?: string): RunPorts {
  return {
    readRun: (id) => readRunRow(query, id),
    beginRun: (id) => beginRunRow(query, id),
    recordRun: (id, snapshot) => recordRunRow(query, id, snapshot),
    ingestWork: (bangumiId, tier, budget) => ingestRunWork(query, bangumiId, runId, budget, egressSigningKey),
    cleanup: (id) => cleanupRawHistory(query, id, keepHistory),
    markRunFailed: (id, reason) => markRunFailedRow(query, id, reason),
  };
}
