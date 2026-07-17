/** Tiered point reads for an already-resolved Bangumi work id. */

import type { CatalogDb } from "../db/client";
import {
  claimIngest,
  ingestGuard,
  runClaimedIngest,
  type IngestClaim,
  type IngestGuard,
  type IngestResult,
} from "../ingest/orchestrator";
import type { FetchLike } from "../ingest/sources";
import { JobStore } from "../ingest/jobs";
import { previewForWork, type MissPreview } from "./preview";
import {
  hitResult,
  searchDb,
  type SearchOptions,
  type SearchResult,
  type WorkPointRow,
} from "./search";

/** Minimal persistence/upstream port for the work-id orchestration. */
export interface WorkPointsDb {
  pointsForWork(workId: string): Promise<WorkPointRow[]>;
  previewForWork(workId: string, fetchImpl?: FetchLike): Promise<MissPreview>;
  ingestGuard(workId: string): Promise<IngestGuard>;
  claimIngest(workId: string): Promise<IngestClaim>;
  markDone(workId: string): Promise<void>;
  runClaimedIngest(workId: string, fetchImpl?: FetchLike): Promise<IngestResult>;
}

/** Return published rows, or a guarded L1 preview while full ingest runs. */
export async function pointsByWorkId(
  db: WorkPointsDb,
  workId: string,
  options: SearchOptions = {},
): Promise<SearchResult> {
  const published = await hitResult(db, workId);
  if (published.rows.length > 0) return published;
  return uncoveredWork(db, workId, options);
}

async function uncoveredWork(
  db: WorkPointsDb,
  workId: string,
  options: SearchOptions,
): Promise<SearchResult> {
  const guard = await db.ingestGuard(workId);
  if (guard !== "ready") return guardedResult(guard);
  const claim = await db.claimIngest(workId);
  if (claim !== "acquired") return claimedElsewhere(claim);
  const published = await hitResult(db, workId);
  if (published.rows.length > 0) {
    await db.markDone(workId);
    return published;
  }
  const preview = await db.previewForWork(workId, options.fetchImpl);
  return claimedResult(db, preview, options);
}

async function claimedResult(
  db: WorkPointsDb,
  preview: MissPreview,
  options: SearchOptions,
): Promise<SearchResult> {
  const ingest = db.runClaimedIngest(preview.workId, options.fetchImpl);
  if (!options.waitUntil) return syncResult(db, preview, ingest);
  options.waitUntil(ingest.catch(() => undefined));
  return previewResult(preview);
}

async function syncResult(
  db: WorkPointsDb,
  preview: MissPreview,
  ingest: Promise<IngestResult>,
): Promise<SearchResult> {
  let result: IngestResult;
  try {
    result = await ingest;
  } catch {
    return previewResult(preview);
  }
  if (result.status === "empty") return emptyResult();
  const published = await hitResult(db, preview.workId);
  return published.rows.length > 0 ? published : previewResult(preview);
}

function claimedElsewhere(claim: Exclude<IngestClaim, "acquired">): SearchResult {
  return claim === "empty" ? emptyResult() : syncingResult();
}

function guardedResult(guard: Exclude<IngestGuard, "ready">): SearchResult {
  return guard === "empty" ? emptyResult() : syncingResult();
}

function previewResult(preview: MissPreview): SearchResult {
  return { rows: preview.points, synced_at: new Date().toISOString(), partial: true };
}

function emptyResult(): SearchResult {
  return { rows: [], synced_at: new Date().toISOString() };
}

function syncingResult(): SearchResult {
  return { ...emptyResult(), partial: true };
}

/** Bind the work-id port to the shared ingest and preview infrastructure. */
export function workPointsDb(db: CatalogDb): WorkPointsDb {
  const search = searchDb(db);
  const jobs = new JobStore(db);
  return {
    pointsForWork: (workId) => search.pointsForWork(workId),
    previewForWork,
    ingestGuard: (workId) => ingestGuard(db, workId),
    claimIngest: (workId) => claimIngest(db, workId),
    markDone: (workId) => jobs.markDone(workId),
    runClaimedIngest: (workId, fetchImpl) => runClaimedIngest(db, workId, { fetchImpl }),
  };
}
