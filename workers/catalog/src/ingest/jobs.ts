/**
 * Singleflight job tracking over the `ingest_jobs` table
 * (`migrations/neon/20260623000001_init.sql`):
 *   work_id (PK), status, stage, error, error_code, negative_cached_until.
 *
 * One ingest per bangumi id runs at a time (singleflight). `acquire` is the
 * gate: a single `INSERT ... ON CONFLICT DO UPDATE ... WHERE` atomically picks
 * exactly one winner under concurrency — losers (an in-flight row, or a live
 * negative cache) skip the UPDATE and see zero RETURNING rows. A recent failure
 * parks the work behind `negative_cached_until` so a hot upstream error is not
 * retried on every request; once that TTL elapses the same statement
 * re-acquires, so a failed job never gets permanently stuck.
 *
 * Statements are built with the Drizzle query builder + the typed expression
 * helpers and run through the single `CatalogDb` seam.
 */
import { and, eq, or, sql, type SQL } from "drizzle-orm";
import type { CatalogDb } from "../db/client";
import { statementBuilder } from "../db/client";
import { ingestJobs } from "../db/schema";
import * as x from "../db/expressions";

const RUNNING_TTL_SECONDS = 15 * 60;

export type IngestGuard = "ready" | "in_progress" | "recently_attempted" | "empty";

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
  acquire(bangumiId: string): Promise<boolean> {
    return acquireJob(this.db, bangumiId);
  }

  /** Read the live persistent guard without claiming ready work. */
  guard(bangumiId: string): Promise<IngestGuard> {
    return readGuard(this.db, bangumiId);
  }

  /** Mark the job done; clears any negative cache. */
  markDone(bangumiId: string): Promise<void> {
    return markJobDone(this.db, bangumiId);
  }

  /** Mark failed and park the work behind negative_cached_until = now()+ttl. */
  async markFailed(bangumiId: string, opts: FailureOptions): Promise<void> {
    if (opts.ttlSeconds <= 0) throw new Error("ttlSeconds must be > 0");
    await markJobFailed(this.db, bangumiId, opts);
  }
}

async function acquireJob(db: CatalogDb, bangumiId: string): Promise<boolean> {
  const result = await db.execute(acquireStatement(bangumiId));
  return result.rows.length > 0;
}

/** The singleflight acquire: INSERT-or-UPDATE, gated by status + stale presence. */
function acquireStatement(bangumiId: string): SQL {
  return statementBuilder()
    .insert(ingestJobs)
    .values({ workId: bangumiId, status: "running", startedAt: x.now() })
    .onConflictDoUpdate({
      target: ingestJobs.workId,
      set: { status: "running", startedAt: x.now() },
      setWhere: or(
        and(
          sql`${ingestJobs.status} <> 'running'`,
          or(sql`${ingestJobs.negativeCachedUntil} IS NULL`, sql`${ingestJobs.negativeCachedUntil} <= NOW()`),
        ),
        and(eq(ingestJobs.status, "running"), x.staleWithinSeconds(ingestJobs.startedAt, ingestJobs.createdAt, RUNNING_TTL_SECONDS)),
      ),
    })
    .returning({ workId: ingestJobs.workId })
    .getSQL();
}

async function readGuard(db: CatalogDb, bangumiId: string): Promise<IngestGuard> {
  const row = await readGuardRow(db, bangumiId);
  if (!row || (!row.runningLive && !row.cacheLive)) return "ready";
  if (row.runningLive) return "in_progress";
  return row.errorCode === "not_found" ? "empty" : "recently_attempted";
}

async function readGuardRow(db: CatalogDb, bangumiId: string): Promise<GuardRow | undefined> {
  const result = await db.execute(guardStatement(bangumiId));
  return parseGuardRow(result.rows[0]);
}

/** The live guard: running-stale flag and negative-cache-until flag. */
function guardStatement(bangumiId: string): SQL {
  return statementBuilder()
    .select({
      errorCode: ingestJobs.errorCode,
      runningLive: sqlFlag(
        and(eq(ingestJobs.status, "running"), x.staleWithinSeconds(ingestJobs.startedAt, ingestJobs.createdAt, RUNNING_TTL_SECONDS)),
      ),
      cacheLive: sqlFlag(sql`${ingestJobs.negativeCachedUntil} > NOW()`),
    })
    .from(ingestJobs)
    .where(eq(ingestJobs.workId, bangumiId))
    .getSQL();
}

async function markJobDone(db: CatalogDb, bangumiId: string): Promise<void> {
  await db.execute(markDoneStatement(bangumiId));
}

function markDoneStatement(bangumiId: string): SQL {
  return statementBuilder()
    .update(ingestJobs)
    .set({
      status: "done", finishedAt: x.now(),
      error: null, errorCode: null, negativeCachedUntil: null,
    })
    .where(and(eq(ingestJobs.workId, bangumiId), eq(ingestJobs.status, "running")))
    .getSQL();
}

async function markJobFailed(db: CatalogDb, bangumiId: string, opts: FailureOptions): Promise<void> {
  await db.execute(markFailedStatement(bangumiId, opts));
}

function markFailedStatement(bangumiId: string, opts: FailureOptions): SQL {
  return statementBuilder()
    .update(ingestJobs)
    .set({
      status: "failed", finishedAt: x.now(),
      error: opts.error ?? null, errorCode: opts.errorCode,
      negativeCachedUntil: addIntervalSeconds(opts.ttlSeconds),
    })
    .where(and(eq(ingestJobs.workId, bangumiId), eq(ingestJobs.status, "running")))
    .getSQL();
}

/** `COALESCE(condition, FALSE)` — a computed boolean projection field. */
function sqlFlag(condition: SQL | undefined): SQL {
  const cond = condition ?? sql`FALSE`;
  return sql`COALESCE(${cond}, FALSE)`;
}

/** `NOW() + make_interval(secs => n)` — a park-until bound in seconds. */
function addIntervalSeconds(seconds: number): SQL {
  return sql`NOW() + make_interval(secs => ${seconds})`;
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
