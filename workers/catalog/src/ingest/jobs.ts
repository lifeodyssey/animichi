/**
 * Singleflight job tracking over the `ingest_jobs` table
 * (`db/migrations/20260623000001_init.sql`):
 *   work_id (PK), status, stage, error, error_code, negative_cached_until.
 *
 * One ingest per work_id runs at a time (singleflight). `acquire` is the gate:
 * a single `INSERT ... ON CONFLICT DO UPDATE ... WHERE` atomically picks exactly
 * one winner under concurrency — losers (an in-flight row, or a live negative
 * cache) skip the UPDATE and see zero RETURNING rows. A recent failure parks the
 * work behind `negative_cached_until` so a hot upstream error is not retried on
 * every request; once that TTL elapses the same statement re-acquires, so a
 * failed job never gets permanently stuck.
 *
 * Writes only: the Drizzle read schema (`src/db/schema.ts`) is query-only, so
 * these mutations go through raw `sql` execute, consistent with the pipeline
 * cards owning all inserts/updates.
 */
import { sql } from "drizzle-orm";
import type { CatalogDb } from "../db/client";

const RUNNING_TTL_SECONDS = 15 * 60;

export type JobGuard = "ready" | "in_progress" | "recently_attempted" | "empty";

interface GuardRow {
  errorCode: string | null;
  runningLive: boolean;
  cacheLive: boolean;
}

/** Failure parameters for {@link JobStore.markFailed}. */
export interface FailureOptions {
  errorCode: string;
  ttlSeconds: number;
  error?: string;
}

/** Singleflight + negative-cache gate over `ingest_jobs`. */
export class JobStore {
  constructor(private readonly db: CatalogDb) {}

  /** True if this caller won the singleflight; false if running or negative-cached. */
  acquire(workId: string): Promise<boolean> {
    return acquireJob(this.db, workId);
  }

  /** Read the live persistent guard without claiming ready work. */
  guard(workId: string): Promise<JobGuard> {
    return readGuard(this.db, workId);
  }

  /** Mark the job done; clears any negative cache. */
  markDone(workId: string): Promise<void> {
    return markJobDone(this.db, workId);
  }

  /** Mark failed and park the work behind negative_cached_until = now()+ttl. */
  async markFailed(workId: string, opts: FailureOptions): Promise<void> {
    if (opts.ttlSeconds <= 0) throw new Error("ttlSeconds must be > 0");
    await markJobFailed(this.db, workId, opts);
  }
}

async function acquireJob(db: CatalogDb, workId: string): Promise<boolean> {
  const result = await db.execute(sql`
    INSERT INTO ingest_jobs (work_id, status, started_at)
    VALUES (${workId}, 'running', NOW())
    ON CONFLICT (work_id) DO UPDATE
      SET status = 'running', started_at = NOW()
      WHERE (ingest_jobs.status <> 'running'
             AND (ingest_jobs.negative_cached_until IS NULL
                  OR ingest_jobs.negative_cached_until <= NOW()))
         OR (ingest_jobs.status = 'running'
             AND COALESCE(ingest_jobs.started_at, ingest_jobs.created_at)
                 <= NOW() - make_interval(secs => ${RUNNING_TTL_SECONDS}))
    RETURNING work_id
  `);
  return result.rows.length > 0;
}

async function readGuard(db: CatalogDb, workId: string): Promise<JobGuard> {
  const row = await readGuardRow(db, workId);
  if (!row || (!row.runningLive && !row.cacheLive)) return "ready";
  if (row.runningLive) return "in_progress";
  return row.errorCode === "not_found" ? "empty" : "recently_attempted";
}

async function readGuardRow(db: CatalogDb, workId: string): Promise<GuardRow | undefined> {
  const result = await db.execute(sql`
    SELECT error_code,
           COALESCE(status = 'running' AND
             COALESCE(started_at, created_at) >
               NOW() - make_interval(secs => ${RUNNING_TTL_SECONDS}), FALSE) AS running_live,
           COALESCE(negative_cached_until > NOW(), FALSE) AS cache_live
    FROM ingest_jobs WHERE work_id = ${workId}
  `);
  return parseGuardRow(result.rows[0]);
}

async function markJobDone(db: CatalogDb, workId: string): Promise<void> {
  await db.execute(sql`
    UPDATE ingest_jobs
    SET status = 'done', finished_at = NOW(),
        error = NULL, error_code = NULL, negative_cached_until = NULL
    WHERE work_id = ${workId} AND status = 'running'
  `);
}

async function markJobFailed(
  db: CatalogDb,
  workId: string,
  opts: FailureOptions,
): Promise<void> {
  await db.execute(sql`
    UPDATE ingest_jobs
    SET status = 'failed', finished_at = NOW(),
        error = ${opts.error ?? null}, error_code = ${opts.errorCode},
        negative_cached_until = NOW() + make_interval(secs => ${opts.ttlSeconds})
    WHERE work_id = ${workId} AND status = 'running'
  `);
}

function parseGuardRow(value: unknown): GuardRow | undefined {
  if (value === null || typeof value !== "object") return undefined;
  const runningLive = runningFlag(value);
  const cacheLive = cacheFlag(value);
  if (runningLive === undefined || cacheLive === undefined) return undefined;
  return { errorCode: errorCode(value), runningLive, cacheLive };
}

function runningFlag(value: object): boolean | undefined {
  if (!("running_live" in value)) return undefined;
  return typeof value.running_live === "boolean" ? value.running_live : undefined;
}

function cacheFlag(value: object): boolean | undefined {
  if (!("cache_live" in value)) return undefined;
  return typeof value.cache_live === "boolean" ? value.cache_live : undefined;
}

function errorCode(value: object): string | null {
  if (!("error_code" in value)) return null;
  return typeof value.error_code === "string" ? value.error_code : null;
}
