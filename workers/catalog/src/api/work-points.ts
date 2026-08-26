// TODO(refactor-skeleton): vertical slice — structure design catalog #837/#838
/** Tiered point reads for an already-resolved Bangumi id. */

import { bangumiPoints } from "../adapters/outbound/bangumi-points";
import {
  pointsByBangumi,
  type PointsByBangumiResult,
  type PublishedPointRow,
} from "../application/list-points-for-bangumi";
import type { CatalogDb } from "../db/client";
import { catalogIngestBangumi, type IngestLifecycle, type IngestResult } from "../ingest/ingest-bangumi";
import type { FetchLike } from "../ingest/sources";
import { previewForWork, type MissPreview } from "./preview";
import type { SearchOptions } from "./search";

/**
 * The read path's port over points + the ingest lifecycle. `ingest` owns the
 * whole guard/claim decision ({@link IngestLifecycle.readClaim}) and the
 * acquire -> completion state machine; this adapter only maps the outcome to
 * preview/empty/syncing HTTP responses (no claim logic of its own).
 */
export interface WorkPointsPort {
  pointsForBangumi(bangumiId: string): Promise<PublishedPointRow[]>;
  previewForWork(bangumiId: string, fetchImpl?: FetchLike): Promise<MissPreview>;
  ingest: IngestLifecycle;
}

/** Return published rows, or a guarded L1 preview while full ingest runs. */
export async function pointsByBangumiId(
  db: WorkPointsPort,
  bangumiId: string,
  options: SearchOptions = {},
): Promise<PointsByBangumiResult> {
  const published = await pointsByBangumi(db, bangumiId);
  if (published.rows.length > 0) return published;
  return uncoveredWork(db, bangumiId, options);
}

async function uncoveredWork(
  db: WorkPointsPort, bangumiId: string, options: SearchOptions,
): Promise<PointsByBangumiResult> {
  const outcome = await db.ingest.readClaim(bangumiId);
  if (outcome.kind === "empty") return emptyResult();
  if (outcome.kind === "syncing") return syncingResult();
  return onAcquired(db, bangumiId, options);
}

/** The claim is held by this call: publish if ready, else preview while ingesting. */
async function onAcquired(
  db: WorkPointsPort, bangumiId: string, options: SearchOptions,
): Promise<PointsByBangumiResult> {
  const published = await pointsByBangumi(db, bangumiId);
  if (published.rows.length > 0) {
    await db.ingest.markDone(bangumiId);
    return published;
  }
  const preview = await db.previewForWork(bangumiId, options.fetchImpl);
  return claimedResult(db, preview, options);
}

async function claimedResult(
  db: WorkPointsPort,
  preview: MissPreview,
  options: SearchOptions,
): Promise<PointsByBangumiResult> {
  const ingest = db.ingest.runClaimed(preview.bangumiId, { fetchImpl: options.fetchImpl });
  if (!options.waitUntil) return syncResult(db, preview, ingest);
  options.waitUntil(ingest.catch((error: unknown) => { logBackgroundIngestFailure(preview.bangumiId, error); }));
  return previewResult(preview);
}

/** SD-19: the upstream error text stays server-side only. */
function logBackgroundIngestFailure(bangumiId: string, error: unknown): void {
  console.error(`[work-points] background ingest failed for bangumi_id=${bangumiId}: ${String(error).slice(0, 200)}`);
}

async function syncResult(
  db: WorkPointsPort,
  preview: MissPreview,
  ingest: Promise<IngestResult>,
): Promise<PointsByBangumiResult> {
  const result = await settledIngest(ingest);
  if (result === "failed") return previewResult(preview);
  if (result.status === "empty") return emptyResult();
  return republishedOrPreview(db, preview);
}

async function settledIngest(ingest: Promise<IngestResult>): Promise<IngestResult | "failed"> {
  try {
    return await ingest;
  } catch {
    return "failed";
  }
}

async function republishedOrPreview(db: WorkPointsPort, preview: MissPreview): Promise<PointsByBangumiResult> {
  const published = await pointsByBangumi(db, preview.bangumiId);
  return published.rows.length > 0 ? published : previewResult(preview);
}

function previewResult(preview: MissPreview): PointsByBangumiResult {
  return { rows: preview.points, synced_at: new Date().toISOString(), partial: true };
}

function emptyResult(): PointsByBangumiResult {
  return { rows: [], synced_at: new Date().toISOString() };
}

function syncingResult(): PointsByBangumiResult {
  return { ...emptyResult(), partial: true };
}

/** Bind the read port to the shared points reader and ingest infrastructure. */
export function workPointsDb(db: CatalogDb): WorkPointsPort {
  const points = bangumiPoints(db);
  return {
    pointsForBangumi: (bangumiId) => points.pointsForBangumi(bangumiId),
    previewForWork,
    ingest: catalogIngestBangumi(db),
  };
}
