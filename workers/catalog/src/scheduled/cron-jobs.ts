/**
 * The cron JOB RUNNERS (S0-v2 D4 + #1006): one function per job the dispatcher
 * can route to, plus the bounded batch they all funnel through.
 *
 * Split out of the dispatcher (`ingest-schedule.ts`) so each file changes for
 * one reason and stays inside the repo's 300-line bound: the dispatcher decides
 * WHICH job a cron event is and owns the pass's seams; these decide what each
 * job does with the seam it is handed.
 *
 * Every runner takes the pass's Prisma seam ({@link CatalogPrisma}) — the
 * dispatcher acquired it and disposes it when the pass ends, so nothing here
 * opens or closes a connection — and the pass's {@link UpstreamAccess}: the
 * egress signing key and the pass's deadline signal. Once that signal aborts,
 * the work in flight is stopped and a batch starts no further work.
 */
import { Budget, canSpendWork, spendWork } from "../ingest/budgets";
import { catalogDailyRun } from "../ingest/catalog-daily-run";
import {
  buildDailyInventory,
  type SeasonalResolver,
} from "../ingest/daily-discovery";
import { fetchCurrentSeason } from "../ingest/season";
import { PENDING_DRAIN_BATCH_CAP, TTL_BATCH_CAP } from "../cron-config";
import type { IngestResult } from "../ingest/ingest-bangumi";
import { SEED_BANGUMI, SEED_BANGUMI_IDS } from "../ingest/seed-works";
import type { SourceConfig, UpstreamAccess } from "../ingest/sources";
import type { DailyRunOutcome } from "../publish/daily-snapshot";
import { dailyPolicy, hourlyIngestBudget } from "../operational-config";
import type { CatalogPrisma } from "../db/prisma";
import type { CronDependencies, CronJobResult } from "./ingest-schedule";

/** The injected snapshot pool keeps N (active) and N-1 (predecessor). */
export const SNAPSHOT_KEEP = 2;

interface IngestBatchPlan {
  query: CatalogPrisma;
  dependencies: CronDependencies;
  bangumiIds: readonly string[];
  budget?: Budget;
  upstream: UpstreamAccess;
}

/** Seed pass: ingest the checked-in titles that have no `done` ingest_jobs row. */
export async function runSeedJob(
  query: CatalogPrisma,
  dependencies: CronDependencies,
  upstream: UpstreamAccess = {},
): Promise<CronJobResult> {
  const done = await dependencies.listDoneBangumiIds(query, SEED_BANGUMI_IDS);
  const pending = SEED_BANGUMI.filter((title) => !done.has(title.bangumiId)).map(
    (title) => title.bangumiId,
  );
  return ingestBatch({ query, dependencies, bangumiIds: pending, upstream });
}

/** TTL pass: re-ingest the stalest raw works, one at a time, capped per run. */
export async function runTtlJob(
  query: CatalogPrisma,
  dependencies: CronDependencies,
  budget = new Budget(hourlyIngestBudget()),
  upstream: UpstreamAccess = {},
): Promise<CronJobResult> {
  const stale = await dependencies.listStaleBangumiIds(query, TTL_BATCH_CAP);
  return ingestBatch({ query, dependencies, bangumiIds: stale.slice(0, TTL_BATCH_CAP), budget, upstream });
}

/** Drain request-parked work in creation order, bounded per invocation. */
export async function runPendingDrainJob(
  query: CatalogPrisma,
  dependencies: CronDependencies,
  budget: Budget | undefined = new Budget(hourlyIngestBudget()),
  upstream: UpstreamAccess = {},
): Promise<CronJobResult> {
  const pending = await dependencies.listDrainableBangumiIds(query, PENDING_DRAIN_BATCH_CAP);
  return ingestBatch({ query, dependencies, bangumiIds: pending, budget, upstream });
}

/** The production daily discovery + ingest run (#1006). Returns the run status. */
export async function runDailyJob(
  query: CatalogPrisma,
  upstream: UpstreamAccess = {},
  seasonalResolver: SeasonalResolver = bangumiSeasonResolver({ signal: upstream.signal }),
): Promise<DailyRunOutcome> {
  const inventory = await buildDailyInventory(query, seasonalResolver);
  return catalogDailyRun(query, Date.now(), inventory, dailyPolicy(), upstream);
}


/** Sequential batch bounded by the shared work/request/runtime ledger and the pass's deadline. */
async function ingestBatch(plan: IngestBatchPlan): Promise<CronJobResult> {
  const summary = { attempted: 0, ingested: 0, skipped: 0, failed: 0 };
  for (const bangumiId of plan.bangumiIds) {
    if (plan.upstream.signal?.aborted === true || !reserveWork(plan.budget)) break;
    summary.attempted++;
    summary[await ingestOne(plan.query, plan.dependencies, bangumiId, plan.upstream)]++;
  }
  return summary;
}

/** The summary count one attempted work lands in. */
type WorkCount = "ingested" | "skipped" | "failed";

function reserveWork(budget: Budget | undefined): boolean {
  if (!budget) return true;
  if (!canSpendWork(budget)) return false;
  spendWork(budget, 2, 0);
  return true;
}

/** One work's ingest, throwing-free — a throw (a stop at the pass's deadline included) is logged and counted as failed. */
async function ingestOne(
  query: CatalogPrisma,
  dependencies: CronDependencies,
  bangumiId: string,
  upstream: UpstreamAccess,
): Promise<WorkCount> {
  try {
    return countOf(await dependencies.ingestBangumi(query, bangumiId, upstream));
  } catch (err) {
    console.error("[cron] ingest failed for work " + bangumiId + ": " + String(err));
    return "failed";
  }
}

/**
 * Where an ingest result lands: `in_progress` (another invocation holds the
 * work, or its last failure is still parked), `claim_lost` (another invocation
 * took the claim over mid-run, so the outcome is its to record) and `empty`
 * (upstream has no points) leave nothing for this pass to ingest, so they are
 * skipped; only a `failed` ingest is a failure.
 */
function countOf(result: IngestResult): WorkCount {
  switch (result.status) {
    case "ingested":
      return "ingested";
    case "in_progress":
    case "claim_lost":
    case "empty":
      return "skipped";
    case "failed":
      return "failed";
  }
}

/**
 * The production current-season resolver: the Bangumi calendar week, fetched
 * through the shared injectable source config (defaults to the real HTTP).
 * An upstream outage degrades to an empty season so popularity + historical
 * discovery still feed the run rather than aborting it.
 */
export function bangumiSeasonResolver(cfg: SourceConfig = {}): SeasonalResolver {
  return () => fetchCurrentSeason(cfg).catch(seasonFallback);
}

/** A failed season fetch logs and yields no season ids (never aborts the run). */
function seasonFallback(error: unknown): readonly string[] {
  console.error("[daily] current-season fetch failed: " + String(error));
  return [];
}
