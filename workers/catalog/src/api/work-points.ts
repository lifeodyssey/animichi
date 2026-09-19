// TODO(refactor-skeleton): vertical slice — structure design catalog #837/#838
/** Tiered point reads for an already-resolved Bangumi id. */

import { bangumiPoints } from "../adapters/outbound/bangumi-points";
import {
  pointsByBangumi,
  type PointsByBangumiResult,
  type PublishedPointRow,
} from "../application/list-points-for-bangumi";
import type { CatalogDb } from "../db/client";
import type { CatalogPrisma } from "../db/prisma";
import { catalogIngestBangumi, type IngestGuard } from "../ingest/ingest-bangumi";
import type { FetchLike } from "../ingest/sources";
import { previewForWork, type MissPreview } from "./preview";

interface PendingIngest {
  guard(bangumiId: string): Promise<IngestGuard>;
  ensurePending(bangumiId: string): Promise<void>;
}

export interface WorkPointsOptions {
  fetchImpl?: FetchLike;
  /** The anitabi egress signing key (#1792); the preview + ingest refuse without it. */
  egressSigningKey?: string;
}

/** The read path's port over published points and durable pending intent. */
export interface WorkPointsPort {
  pointsForBangumi(bangumiId: string): Promise<PublishedPointRow[]>;
  previewForWork(bangumiId: string, fetchImpl?: FetchLike, egressSigningKey?: string): Promise<MissPreview>;
  ingest: PendingIngest;
}

/** Return published rows, or park an uncovered work and serve its L1 preview. */
export async function pointsByBangumiId(
  db: WorkPointsPort,
  bangumiId: string,
  options: WorkPointsOptions = {},
): Promise<PointsByBangumiResult> {
  const published = await pointsByBangumi(db, bangumiId);
  if (published.rows.length > 0) return published;
  return uncoveredWork(db, bangumiId, options);
}

async function uncoveredWork(
  db: WorkPointsPort, bangumiId: string, options: WorkPointsOptions,
): Promise<PointsByBangumiResult> {
  const guard = await db.ingest.guard(bangumiId);
  if (guard === "empty") return emptyResult();
  if (guard !== "ready") return syncingResult();
  await db.ingest.ensurePending(bangumiId);
  const preview = await db.previewForWork(bangumiId, options.fetchImpl, options.egressSigningKey);
  return previewResult(preview);
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

/** Bind the read port to the shared points reader and ingest infrastructure (#1792: egress required for anitabi).
 *
 * Both seams are parameters because the migration is mid-flight: the published
 * points read through `adapters/outbound/bangumi-points.ts` is Prisma's (#1631,
 * spec §4.2) off this request's runtime, while the ingest (`ingest/`) is still
 * Drizzle's until #1630 converts it. `db` is that not-yet-moved seam, not a
 * second Prisma construction site.
 */
export function workPointsDb(
  prisma: CatalogPrisma,
  db: CatalogDb,
  egressSigningKey?: string,
): WorkPointsPort {
  const points = bangumiPoints(prisma);
  return {
    pointsForBangumi: (bangumiId) => points.pointsForBangumi(bangumiId),
    previewForWork: (bangumiId, fetchImpl) => previewForWork(bangumiId, fetchImpl, egressSigningKey),
    ingest: catalogIngestBangumi(db, egressSigningKey),
  };
}
