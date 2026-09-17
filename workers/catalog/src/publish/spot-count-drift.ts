/**
 * Spot count drift (X15 #285).
 *
 * The SpotCountDrift policy: when a work's publishable spot count moves by
 * DRIFT_ALERT_RATIO or more against its last publish, the publish must alert
 * instead of silently flipping the public snapshot — a mass gain or loss is
 * how a broken ingest shows up in the catalog. The ratio is undefined from a
 * zero baseline (a work gaining its very first spots is growth, not drift),
 * so a zero-baseline work never alerts.
 */

/**
 * The drift alert ratio (initial value from card #285): on the fixture-typical
 * per-work counts (≥ 10 spots for mapped titles) single-spot ingest noise is
 * ≤ 10%, well inside the band, while the failure mode this gate exists for —
 * a wiped or duplicated work — moves the count by ±100%.
 */
export const DRIFT_ALERT_RATIO = 0.3;

/** One work's drift against its last published count. */
export interface SpotCountDrift {
  readonly bangumiId: string;
  readonly previousCount: number;
  readonly currentCount: number;
  /** Signed (current − previous) / previous, from a non-zero baseline. */
  readonly driftRatio: number;
}

/** Per-work spot counts; a work absent from the map has no baseline. */
export type WorkSpotCounts = ReadonlyMap<string, number>;

/** Aggregate rows into per-work spot counts; rows without a work are skipped. */
export function spotCountsByWork(rows: readonly { bangumiId: string | null }[]): WorkSpotCounts {
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (row.bangumiId === null) continue;
    counts.set(row.bangumiId, (counts.get(row.bangumiId) ?? 0) + 1);
  }
  return counts;
}

/** The works whose count moved by the alert ratio or more against the last publish. */
export function spotCountDrifts(
  previous: WorkSpotCounts, current: WorkSpotCounts, alertRatio: number = DRIFT_ALERT_RATIO,
): SpotCountDrift[] {
  const drifts: SpotCountDrift[] = [];
  for (const [bangumiId, previousCount] of previous) {
    const drift = countDrift(bangumiId, previousCount, current.get(bangumiId) ?? 0, alertRatio);
    if (drift !== null) drifts.push(drift);
  }
  return drifts;
}

/** The work's drift, or null when the baseline is zero or the move is inside the band. */
function countDrift(
  bangumiId: string, previousCount: number, currentCount: number, alertRatio: number,
): SpotCountDrift | null {
  if (previousCount === 0) return null;
  const driftRatio = (currentCount - previousCount) / previousCount;
  if (Math.abs(driftRatio) < alertRatio) return null;
  return { bangumiId, previousCount, currentCount, driftRatio };
}
