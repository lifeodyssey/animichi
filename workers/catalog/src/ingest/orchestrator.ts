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
 * Both catalog read paths use this gate: title search starts it after resolving
 * a preview, and the work-id path consults the same persisted marker first.
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
  UpstreamNotFoundError,
  UpstreamFetchError,
} from "./sources";

/** Retry ordinary failures after one hour; recheck confirmed-empty works weekly. */
const FAILURE_TTL_SECONDS = 60 * 60;
const EMPTY_TTL_SECONDS = 7 * 24 * 60 * 60;
/** Error codes parked behind the negative cache (no bare strings). */
const ErrorCode = { NotFound: "not_found", IngestError: "ingest_error" } as const;

/** Knobs for {@link ingestWork} (defaulted for prod; tests inject `fetchImpl`). */
export interface IngestOptions {
  fetchImpl?: FetchLike;
}

export type IngestGuard = "ready" | "in_progress" | "recently_attempted" | "empty";
export type IngestClaim = "acquired" | Exclude<IngestGuard, "ready">;

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
  const claim = await claimIngest(db, bangumiId);
  if (claim === "acquired") return runClaimedIngest(db, bangumiId, opts);
  if (claim === "empty") return { status: "empty", reason: "no points" };
  return { status: "in_progress" };
}

/** Read the persisted marker before paying for an L1 preview. */
export function ingestGuard(db: CatalogDb, workId: string): Promise<IngestGuard> {
  return new JobStore(db).guard(workId);
}

/** Atomically reserve the expensive preview and full-ingest work. */
export async function claimIngest(db: CatalogDb, workId: string): Promise<IngestClaim> {
  const jobs = new JobStore(db);
  if (await jobs.acquire(workId)) return "acquired";
  const guard = await jobs.guard(workId);
  return guard === "ready" ? "in_progress" : guard;
}

/** Run a full ingest for a work whose `ingest_jobs` claim is already held. */
export function runClaimedIngest(
  db: CatalogDb,
  workId: string,
  opts: IngestOptions = {},
): Promise<IngestResult> {
  return runIngest(db, new JobStore(db), workId, opts.fetchImpl);
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
    if (err instanceof UpstreamNotFoundError) {
      return failJob(jobs, workId, ErrorCode.NotFound, String(err));
    }
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
  const ttlSeconds = errorCode === ErrorCode.NotFound ? EMPTY_TTL_SECONDS : FAILURE_TTL_SECONDS;
  await jobs.markFailed(workId, { errorCode, ttlSeconds, error: reason });
  const status = errorCode === ErrorCode.NotFound ? "empty" : "failed";
  return { status, reason };
}
