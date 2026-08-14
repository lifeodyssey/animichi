/**
 * Protected canary + full-ingest commands (issue #1016, AC5).
 *
 * Staging runs no automatic upstream crawler (§183), but a Catalog developer
 * must be able to exercise the crawler changes through an EXPLICIT protected
 * command. fullIngest runs the same production daily pipeline (catalogDailyRun
 * with the production daily policy + discovery inventory); canary runs a fixed
 * regression set plus a deterministic daily rotating sample through the same
 * pipeline with a bounded policy. Both are exposed as admin routes guarded by
 * CATALOG_ADMIN_TOKEN and reject public/unauthorized callers.
 */
import type { CatalogDb } from "../db/client";
import { catalogDailyRun } from "../ingest/catalog-daily-run";
import { buildDailyInventory, type SeasonalResolver } from "../ingest/daily-discovery";
import { dailyPolicy } from "../operational-config";
import { bangumiSeasonResolver } from "../index";
import type { DailyRunInputs } from "../ingest/catalog-daily-run";
import type { DailyRunOutcome } from "../publish/daily-snapshot";
import type { TierName, TieredWork } from "../ingest/tiers";

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

/** Run the explicit full ingest through the production daily pipeline (AC5). */
export async function fullIngest(
  db: CatalogDb,
  epochMs: number,
  seasonalResolver: SeasonalResolver = bangumiSeasonResolver(),
): Promise<DailyRunOutcome> {
  const inventory = await buildDailyInventory(db, seasonalResolver);
  return catalogDailyRun(db, epochMs, inventory, dailyPolicy());
}

/** Run the protected canary through the production daily pipeline (AC5). */
export async function runCanaryCommand(
  db: CatalogDb,
  epochMs: number,
): Promise<DailyRunOutcome> {
  const tiered = canarySelection(epochMs);
  const inputs: DailyRunInputs = {
    discovery: [],
    knownIds: new Set(tiered.map((work) => work.bangumiId)),
    tiered,
  };
  return catalogDailyRun(db, epochMs, inputs, canaryPolicy());
}
