/**
 * Refresh tiers for the daily discovery+ingest run (#1006 AC3).
 *
 * Works are grouped into volatility tiers (high/medium/low); each tier carries a
 * refresh interval (how long a work can sit stale before it is due again). Tier
 * config, per-work tier mapping, and the "how many new works fit a daily budget"
 * bounds all come from the caller — there are no source-code intervals or caps
 * here. Selection is pure: given last-ingested timestamps, a clock, and a bounded
 * "walkers" allowance, it returns the deterministic set of due works ordered by
 * tier priority.
 */
export interface RefreshTierConfig {
  /** TTL: a work at this tier is due once its last ingest is older than this (ms). */
  refreshIntervalMs: number;
  /** Selection priority: lower number = handled first within a run. */
  priority: number;
}

/** The named volatility tiers in selection order. */
export const TIER_NAMES = ["high", "medium", "low"] as const;
export type TierName = (typeof TIER_NAMES)[number];

/** A work known to the run with its tier and last ingest time. */
export interface TieredWork {
  bangumiId: string;
  tier: TierName;
  lastIngestedAtMs: number | null;
}

/** A tiered work that is due, in selection order. */
export interface DueWork {
  bangumiId: string;
  tier: TierName;
}

/** Build a tier config map from per-tier intervals (all required). */
export function tiersFromConfig(config: Record<TierName, number>): Record<TierName, RefreshTierConfig> {
  return {
    high: tierConfig("high", config.high, 1),
    medium: tierConfig("medium", config.medium, 2),
    low: tierConfig("low", config.low, 3),
  };
}

/** A work is due when it has never been ingested or its last ingest is stale. */
export function workIsDue(work: TieredWork, config: Record<TierName, RefreshTierConfig>, nowMs: number): boolean {
  if (work.lastIngestedAtMs === null) return true;
  const interval = config[work.tier].refreshIntervalMs;
  return nowMs - work.lastIngestedAtMs >= interval;
}

/**
 * Deterministically select due works: tier-priority order then source order,
 * bounded by `cap`. Duplicate ids never appear twice.
 */
export function selectDueWorks(
  works: readonly TieredWork[],
  config: Record<TierName, RefreshTierConfig>,
  nowMs: number,
  cap: number,
): DueWork[] {
  const due = works
    .filter((work) => workIsDue(work, config, nowMs))
    .sort(byPriority(config));
  return takeNewest(due, cap);
}

/** Sort due works by tier priority (stable), preserving source order within a tier. */
function byPriority(config: Record<TierName, RefreshTierConfig>): (a: TieredWork, b: TieredWork) => number {
  return (a, b) => config[a.tier].priority - config[b.tier].priority;
}

/** Take the first `cap` unique ids; a non-positive cap yields an empty selection. */
function takeNewest(due: readonly TieredWork[], cap: number): DueWork[] {
  if (!Number.isInteger(cap) || cap <= 0) return [];
  const seen = new Set<string>();
  const result: DueWork[] = [];
  for (const work of due) {
    if (seen.has(work.bangumiId)) continue;
    seen.add(work.bangumiId);
    result.push({ bangumiId: work.bangumiId, tier: work.tier });
    if (result.length >= cap) break;
  }
  return result;
}

/** One tier's config with an explicit priority. */
function tierConfig(name: TierName, intervalMs: number, priority: number): RefreshTierConfig {
  assertInterval(intervalMs, name);
  return { refreshIntervalMs: intervalMs, priority };
}

function assertInterval(intervalMs: number, name: string): void {
  if (!Number.isInteger(intervalMs) || intervalMs <= 0) {
    throw new Error(name + " refresh interval must be a positive integer (ms)");
  }
}
