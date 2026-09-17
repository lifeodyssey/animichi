/**
 * The spot quality gate (X15 #285).
 *
 * The row-level publish gate for exported point rows: it rejects rows whose
 * coordinates cannot be published (`isPublishableSpotCoordinates`), merges
 * same-episode duplicates within the dedupe radius (`mergeDuplicateSpots`),
 * and raises spot-count drift alerts against the last publish
 * (`spotCountDrifts`). Its `publishable` output is the only spot rows the
 * publish pipeline bundles into the public snapshot — rejected and merged
 * rows never flow into a public page.
 *
 * The gate decides without rebuilding: publishable rows are the untouched
 * input values, so the exported bytes stay the row objects the reader knows.
 */
import {
  mergeDuplicateSpots, type DuplicateSpotMerge, type LocatedEpisodeSpot,
} from "./duplicate-spots";
import {
  spotCountDrifts, spotCountsByWork, type SpotCountDrift, type WorkSpotCounts,
} from "./spot-count-drift";
import { isPublishableSpotCoordinates } from "./spot-coordinates";

/** The row view the gate decides on; every exported point row carries these. */
export type GateableSpot = LocatedEpisodeSpot & { readonly bangumiId: string | null };

/** Why the gate rejected a row. */
export type SpotRejectionReason = "unpublishable-coordinates";

/** One rejected row, identified for the alert seam (never coordinates). */
export interface RejectedSpot {
  readonly spotId: string;
  readonly bangumiId: string | null;
  readonly reason: SpotRejectionReason;
}

/** What one gated publish did to the spot rows — the alert payload. */
export interface SpotQualityReport {
  readonly rejectedSpots: readonly RejectedSpot[];
  readonly duplicateMerges: readonly DuplicateSpotMerge[];
  readonly spotCountDrifts: readonly SpotCountDrift[];
}

/**
 * The quality alert seam (the catalog's log/notification port): one call per
 * gated publish. The default wires the report to structured console warns.
 */
export interface SpotQualityAlerts {
  spotQualityReport(report: SpotQualityReport): void;
}

/** The gate outcome: the only publishable rows + the report raised to the seam. */
export interface GatedSpots<T extends GateableSpot> {
  readonly publishable: readonly T[];
  readonly report: SpotQualityReport;
}

/** Gate the exported spot rows for one publish against the last publish's counts. */
export function gateSpotRows<T extends GateableSpot>(
  rows: readonly T[], previousCounts: WorkSpotCounts, alerts: SpotQualityAlerts,
): GatedSpots<T> {
  const coordinateGate = gateCoordinates(rows);
  const merge = mergeDuplicateSpots(coordinateGate.publishable);
  const report: SpotQualityReport = {
    rejectedSpots: coordinateGate.rejected,
    duplicateMerges: merge.merges,
    spotCountDrifts: spotCountDrifts(previousCounts, spotCountsByWork(merge.publishable)),
  };
  alerts.spotQualityReport(report);
  return { publishable: merge.publishable, report };
}

/** The default alert seam: structured console warns, the catalog's existing observability. */
export function consoleSpotQualityAlerts(): SpotQualityAlerts {
  return { spotQualityReport: logSpotQualityReport };
}

interface CoordinateGate<T extends GateableSpot> {
  readonly publishable: readonly T[];
  readonly rejected: readonly RejectedSpot[];
}

/** Partition rows by the publishable-coordinates specification, input order preserved. */
function gateCoordinates<T extends GateableSpot>(rows: readonly T[]): CoordinateGate<T> {
  const publishable: T[] = [];
  const rejected: RejectedSpot[] = [];
  for (const row of rows) {
    if (isPublishableSpotCoordinates(row)) publishable.push(row);
    else rejected.push(rejectedSpot(row));
  }
  return { publishable, rejected };
}

function rejectedSpot(row: GateableSpot): RejectedSpot {
  return { spotId: row.id, bangumiId: row.bangumiId, reason: "unpublishable-coordinates" };
}

function logSpotQualityReport(report: SpotQualityReport): void {
  for (const spot of report.rejectedSpots) {
    console.warn(`[spot-quality-gate] rejected spot ${spot.spotId} of work ${String(spot.bangumiId)}: ${spot.reason}`);
  }
  for (const merge of report.duplicateMerges) {
    console.warn(`[spot-quality-gate] merged ${String(merge.mergedSpotIds.length)} duplicate spots into ${merge.keptSpotId}`);
  }
  for (const drift of report.spotCountDrifts) {
    console.warn(`[spot-quality-gate] spot count drift for work ${drift.bangumiId}: ${String(drift.previousCount)} -> ${String(drift.currentCount)} (${driftPercent(drift)}%)`);
  }
}

/** The drift ratio as a whole-percent string (e.g. "-70" for a mass loss). */
function driftPercent(drift: SpotCountDrift): string {
  return String(Math.round(drift.driftRatio * 100));
}
