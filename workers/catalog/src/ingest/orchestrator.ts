/**
 * On-demand ingest orchestrator (card W5): ingest a not-yet-cataloged work
 * end-to-end by composing the committed pieces.
 *
 * Composes the pipeline kernels behind one singleflight gate:
 *   1. JobStore.acquire(workId) — the singleflight winner proceeds; a loser (an
 *      in-flight peer, or a live negative cache) returns `in_progress` and does
 *      no work. This is the ONLY place work is gated, so concurrent requests for
 *      the same work fold into one fetch+enrich.
 *   2. fetch the Bangumi subject + Anitabi points (injectable `fetchImpl`).
 *   3. if Anitabi returns no points -> markFailed(NOT_FOUND, ttl) so the empty
 *      upstream is negative-cached, then return `empty` (don't publish a
 *      pointless empty catalog version).
 *   4. else save BOTH raw payloads -> enrichWork (raw -> catalog -> publish) ->
 *      markDone -> return `ingested` with the published version + point count.
 *   5. ANY thrown error -> markFailed(INGEST_ERROR, ttl); upstream transport
 *      failures then rethrow as typed retryable errors, while internal failures
 *      return `failed` as before.
 *
 * FOLLOW-UPS (noted, NOT built here): the L1 fast-preview vs L2 full-sync
 * tiering (return a preview before enrich completes), the oRPC ingest endpoint
 * that calls this, and the agent's catalog-miss trigger that drives it.
 */
import type { CatalogDb } from "../db/client";
import { enrichWork } from "../enrich/enrich";
import { upstreamUnavailable } from "../lib/errors";
import { JobStore } from "./jobs";
import { saveRawAnitabi, saveRawBangumi } from "./raw-store";
import {
  fetchAnitabiPoints,
  fetchBangumiSubject,
  type AnitabiPoint,
  type BangumiSubject,
  type FetchLike,
  UpstreamFetchError,
} from "./sources";

/** Negative-cache TTL for empty / failed ingests (seconds). */
const FAILURE_TTL_SECONDS = 3600;
/** Error codes parked behind the negative cache (no bare strings). */
const ErrorCode = { NotFound: "not_found", IngestError: "ingest_error" } as const;

/** Knobs for {@link ingestWork} (defaulted for prod; tests inject `fetchImpl`). */
export interface IngestOptions {
  fetchImpl?: FetchLike;
}

/** Discriminated union: the outcome of one {@link ingestWork} call. */
export type IngestResult =
  | { status: "ingested"; version: number; pointCount: number }
  | { status: "in_progress" }
  | { status: "empty"; reason: string }
  | { status: "failed"; reason: string };

/** Ingest a work; upstream transport failures escape as typed oRPC errors. */
export async function ingestWork(
  db: CatalogDb,
  bangumiId: string,
  opts: IngestOptions = {},
): Promise<IngestResult> {
  const jobs = new JobStore(db);
  if (!(await jobs.acquire(bangumiId))) return { status: "in_progress" };
  return runIngest(db, jobs, bangumiId, opts.fetchImpl);
}

/** Negative-cache every failure, then preserve typed upstream transport errors. */
async function runIngest(
  db: CatalogDb,
  jobs: JobStore,
  workId: string,
  fetchImpl?: FetchLike,
): Promise<IngestResult> {
  try {
    return await ingestAcquired(db, jobs, workId, fetchImpl);
  } catch (err) {
    const result = await failJob(jobs, workId, ErrorCode.IngestError, String(err));
    if (err instanceof UpstreamFetchError) throw upstreamUnavailable(err.upstream, err);
    return result;
  }
}

/** Fetch -> raw -> enrich -> publish for the work this caller has acquired. */
async function ingestAcquired(
  db: CatalogDb,
  jobs: JobStore,
  workId: string,
  fetchImpl?: FetchLike,
): Promise<IngestResult> {
  const { subject, points } = await fetchUpstream(workId, fetchImpl);
  if (points.length === 0) return failJob(jobs, workId, ErrorCode.NotFound, "no points");
  await persistRaw(db, workId, subject, points);
  const enriched = await enrichWork(db, workId);
  await jobs.markDone(workId);
  return { status: "ingested", version: enriched.version, pointCount: enriched.pointCount };
}

/** Fetch the Bangumi subject + Anitabi points for the work. */
async function fetchUpstream(
  workId: string,
  fetchImpl?: FetchLike,
): Promise<{ subject: BangumiSubject; points: AnitabiPoint[] }> {
  const [subject, points] = await Promise.all([
    fetchBangumiSubject(workId, { fetchImpl }),
    fetchAnitabiPoints(workId, { fetchImpl }),
  ]);
  return { subject, points };
}

/** Save both upstream payloads verbatim into the raw zone. */
async function persistRaw(
  db: CatalogDb,
  workId: string,
  subject: BangumiSubject,
  points: AnitabiPoint[],
): Promise<void> {
  await saveRawBangumi(db, workId, subject);
  await saveRawAnitabi(db, workId, points);
}

/** Negative-cache the failure (clears the 'running' row) and report `empty`/`failed`. */
async function failJob(
  jobs: JobStore,
  workId: string,
  errorCode: string,
  reason: string,
): Promise<IngestResult> {
  await jobs.markFailed(workId, { errorCode, ttlSeconds: FAILURE_TTL_SECONDS, error: reason });
  const status = errorCode === ErrorCode.NotFound ? "empty" : "failed";
  return { status, reason };
}
