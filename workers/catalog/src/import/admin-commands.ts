/**
 * Protected canary + full-ingest commands (issue #1016, AC5).
 *
 * Staging runs no automatic upstream crawler (§183), but a Catalog developer
 * must be able to exercise the crawler changes through an EXPLICIT protected
 * command. fullIngest runs the same production daily pipeline (catalogDailyRun
 * with the production daily policy + discovery inventory) and mirrors the
 * production cron's publish-after-run gate; canary runs a fixed regression set
 * plus a deterministic daily rotating sample through the same pipeline with a
 * bounded policy, ingest-only. Both are exposed as admin routes guarded by
 * CATALOG_ADMIN_TOKEN and reject public/unauthorized callers.
 */
import type { CatalogPrisma } from "../db/prisma";
import { catalogDailyRun } from "../ingest/catalog-daily-run";
import { buildDailyInventory, type SeasonalResolver } from "../ingest/daily-discovery";
import { dailyPolicy } from "../operational-config";
import type { DailyRunInputs } from "../ingest/catalog-daily-run";
import { publishAfterRun, type DailyPublishPorts } from "../publish/daily-snapshot";
import { publishSnapshot } from "../publish/snapshot";
import { gcSnapshots } from "../publish/snapshot-gc";
import type { ObjectStore } from "../publish/object-store";
import type { DailyRunOutcome } from "../publish/daily-snapshot";
import type { TierName, TieredWork } from "../ingest/tiers";
import { bangumiSeasonResolver, SNAPSHOT_KEEP } from "../scheduled/cron-jobs";

/** A clock seam so the rotating canary selection is deterministic in tests. */
export type Clock = () => number;

/** Fixed regression works exercised by every canary run. */
export const CANARY_FIXED_WORKS = ["2815", "3302", "70379"];

/** A pool from which the daily rotating sample is drawn deterministically. */
export const CANARY_ROTATING_POOL = ["371", "4177", "114", "3595"];

const CANARY_TIER: TierName = "high";

/**
 * The canary work set: the fixed regression works plus one rotating sample
 * chosen by the UTC day (epochMs injected — no wall-clock timing asserts).
 */
export function canarySelection(epochMs: number): readonly TieredWork[] {
  const day = Math.floor(epochMs / 86_400_000);
  const rotating = CANARY_ROTATING_POOL[day % CANARY_ROTATING_POOL.length];
  const ids = [...CANARY_FIXED_WORKS, ...(rotating === undefined ? [] : [rotating])];
  return ids.map((bangumiId) => ({ bangumiId, tier: CANARY_TIER, lastIngestedAtMs: null }));
}

/** A bounded policy so a canary exercises the pipeline without a full crawl. */
export function canaryPolicy() {
  const base = dailyPolicy();
  return { ...base, newWorkCap: 5, budget: { workLimit: 6, requestLimit: 40, runtimeLimitMs: 3 * 60 * 1000 } };
}

/**
 * Run the explicit full ingest through the production daily pipeline (AC5).
 *
 * Mirrors the production cron exactly: it runs the same downstream daily
 * pipeline (discovery inventory + catalogDailyRun under the production daily
 * policy) and then, when the run completes AND a snapshot store is present,
 * publishes the immutable snapshot and GCs the N/N-1 pool — the same
 * publish-after-run gate the dailyDiscover cron performs. The controlled epoch
 * keeps scheduling deterministic in tests; the store is threaded from the route.
 *
 * The run and the snapshot publish it can trigger are one seam: this request's
 * {@link CatalogPrisma} runtime (#1630).
 */
export async function fullIngest(
  query: CatalogPrisma,
  epochMs: number,
  store: ObjectStore | null,
  seasonalResolver: SeasonalResolver = bangumiSeasonResolver(),
): Promise<DailyRunOutcome> {
  const outcome = controlledDailyRun(query, epochMs, seasonalResolver);
  const ports: DailyPublishPorts = {
    runDailyIngest: () => outcome,
    publishRun: (s, sourceRunId, createdAt) =>
      publishSnapshot({ query, store: s }, { sourceRunId, createdAt }),
    gcSnapshots: (s) => gcSnapshots(s, SNAPSHOT_KEEP),
  };
  await publishAfterRun(store, ports);
  return outcome;
}

/** The production daily pipeline over a controlled epoch (discovery + run). */
function controlledDailyRun(
  query: CatalogPrisma,
  epochMs: number,
  seasonalResolver: SeasonalResolver,
): Promise<DailyRunOutcome> {
  return buildDailyInventory(query, seasonalResolver).then((inventory) =>
    catalogDailyRun(query, epochMs, inventory, dailyPolicy()),
  );
}

/**
 * Run the protected canary through the production daily pipeline (AC5).
 *
 * Deliberately INGEST-ONLY: the canary exercises a bounded slice of the crawler
 * pipeline (fixed regression works + one rotating sample) and NEVER publishes a
 * snapshot or runs the publish-after-run gate. It must never mutate the
 * published catalog, and publishing a partial or rotating run would corrupt the
 * N/N-1 snapshot pool — so no ObjectStore is threaded to this command.
 */
export async function runCanaryCommand(
  query: CatalogPrisma,
  epochMs: number,
): Promise<DailyRunOutcome> {
  const tiered = canarySelection(epochMs);
  const inputs: DailyRunInputs = {
    discovery: [],
    knownIds: new Set(tiered.map((work) => work.bangumiId)),
    tiered,
  };
  return catalogDailyRun(query, epochMs, inputs, canaryPolicy());
}
