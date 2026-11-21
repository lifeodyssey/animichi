/**
 * Singleflight job tracking over the `ingest_jobs` table
 * (the data-plane contract):
 *   work_id (PK), status, stage, error, error_code, negative_cached_until.
 *
 * One ingest per bangumi id runs at a time (singleflight). `acquire` is the
 * gate: it picks exactly one winner under concurrency — losers (an in-flight
 * row, or a live negative cache) see no claim. A recent failure parks the work
 * behind `negative_cached_until` so a hot upstream error is not retried on every
 * request; once that TTL elapses the same claim re-acquires, so a failed job
 * never gets permanently stuck.
 *
 * The gate is the one write the conflict clause cannot serve: it has to leave a
 * live run untouched, which is `ON CONFLICT … DO UPDATE … WHERE`, and the
 * Postgres renderer emits no conflict predicate (see `db/plans.ts`). It is stated
 * as the pair that predicate means — UPDATE the row when it is claimable, else
 * INSERT it — and the claim's atomicity comes from the unique key: two callers
 * that both found no row race on the INSERT, and the loser reads `23505` and
 * reports "not acquired" instead of retrying into a second claim.
 *
 * A claim is the `started_at` stamp its acquire wrote, so the completion and
 * failure writes are fenced on that stamp as well as on `running`: a claim left
 * past RUNNING_TTL can be reclaimed by another invocation, which restamps the
 * row and keeps it `running`, and a fence on the status alone would let the
 * stalled holder overwrite the winner's live claim. A fenced write that changes
 * no row reports `claim_lost`, so the holder knows the result is not its own.
 *
 * Statements are builder plans run on the request's runtime ({@link
 * CatalogPrisma}). The claimability predicate is stated once, as a `where`
 * callback shared by every write that has to respect it, and its two clock
 * questions are `fns.raw` fragments inside that callback — the shape the
 * outbound adapters state their trigram and aggregate fragments in.
 */
import type { SqlOrmPlan } from "@prisma/orm-postgres/relational-core/types";
import type { CatalogPrisma } from "../db/prisma";
import { atServerClock, atServerNow } from "../db/plans";
import { isUniqueViolation } from "../db/pg-error";
import { fetchStage, IngestErrorCode } from "./ingest-failure";
import type { UpstreamName } from "./upstream-failures";

export const RUNNING_TTL_SECONDS = 15 * 60;

export type IngestGuard = "ready" | "in_progress" | "recently_attempted" | "empty";

interface GuardRow {
  error_code: string | null;
  running_live: boolean;
  cache_live: boolean;
}

/** A claim this invocation holds: the work and the `started_at` stamp its acquire wrote. */
export interface JobClaim {
  readonly workId: string;
  readonly startedAt: string;
}

/** What a fenced write did: `claim_lost` when the row no longer carries the claim and nothing changed. */
export type ClaimWrite = "recorded" | "claim_lost";

/** Failure parameters for {@link JobStore.markFailed}. */
export interface FailureOptions {
  errorCode: string;
  ttlSeconds: number;
  error?: string;
  /** Where the pipeline stopped, e.g. `fetch:anitabi`; absent when not an upstream fetch. */
  stage?: string;
}

/** What parking a request-triggered work resets a row to. */
const PENDING = {
  status: "pending", started_at: null, finished_at: null, error: null,
  error_code: null, stage: null, negative_cached_until: null,
} as const;

/** Singleflight + negative-cache gate over `ingest_jobs`. */
export class JobStore {
  constructor(private readonly query: CatalogPrisma) {}

  /** This caller's claim when it won the singleflight; null if running or negative-cached. */
  acquire(bangumiId: string): Promise<JobClaim | null> {
    return acquireJob(this.query, bangumiId);
  }

  /** Read the live persistent guard without claiming ready work. */
  guard(bangumiId: string): Promise<IngestGuard> {
    return readGuard(this.query, bangumiId);
  }

  /** Durably park request-triggered work for the scheduled drain. */
  async ensurePending(bangumiId: string): Promise<void> {
    const parked = await this.query.executor.query(claimableUpdate(this.query, bangumiId, PENDING));
    if (parked.length === 0) await createRow(this.query, bangumiId, PENDING);
  }

  /** Mark the claimed job done and clear any negative cache, unless the claim was lost. */
  async markDone(claim: JobClaim): Promise<ClaimWrite> {
    return fencedOutcome(await this.query.executor.query(markDonePlan(this.query, claim)));
  }

  /** Mark the claimed job failed and park it behind negative_cached_until = now()+ttl, unless the claim was lost. */
  async markFailed(claim: JobClaim, opts: FailureOptions): Promise<ClaimWrite> {
    if (opts.ttlSeconds <= 0) throw new Error("ttlSeconds must be > 0");
    return fencedOutcome(await this.query.executor.query(markFailedPlan(this.query, claim, opts)));
  }

  /** Whether `upstream` already has a refusal parked behind a live negative cache. */
  async hasLiveRefusal(upstream: UpstreamName): Promise<boolean> {
    const rows = await this.query.executor.query(liveRefusalPlan(this.query, upstream));
    return rows.length > 0;
  }
}

/** The singleflight acquire: claim the existing row, else create it. */
async function acquireJob(query: CatalogPrisma, bangumiId: string): Promise<JobClaim | null> {
  const [claimed] = await query.executor.query(claimableUpdate(query, bangumiId, { status: "running" }));
  const row = claimed ?? await createRow(query, bangumiId, { status: "running" });
  return row === null ? null : claimOf(row);
}

/** The row a claim or a park returns: the work and the stamp it now carries. */
interface StampedRow {
  work_id: string;
  started_at: string | null;
}

/** The claim a stamped row stands for; a row the write did not stamp is no claim. */
function claimOf(row: StampedRow): JobClaim | null {
  return row.started_at === null ? null : { workId: row.work_id, startedAt: row.started_at };
}

/**
 * UPDATE the work's row when it is claimable, returning it when claimed and
 * nothing when it is absent or parked.
 */
function claimableUpdate(
  query: CatalogPrisma, bangumiId: string, values: JobValues,
): SqlOrmPlan<StampedRow> {
  const update = query.builder.public.ingest_jobs
    .update(values)
    .where((fields, fns) => fns.and(
      fns.eq(fields.work_id, bangumiId),
      fns.or(
        fns.and(
          fns.ne(fields.status, "running"),
          fns.raw`(${fields.negative_cached_until} is null or ${fields.negative_cached_until} <= now())`.returns("pg/bool@1"),
        ),
        fns.and(
          fns.eq(fields.status, "running"),
          fns.raw`coalesce(${fields.started_at}, ${fields.created_at}) <= now() - make_interval(secs => ${RUNNING_TTL_SECONDS})`.returns("pg/bool@1"),
        ),
      ),
    ))
    .returning("work_id", "started_at")
    .build();
  const stamps = startStamp(values);
  // A park clears the heartbeat rather than moving it, so there is nothing to
  // stamp — and a plan repair with no columns is not a no-op, it is an error.
  return stamps.length === 0 ? update : atServerNow(update, stamps);
}

/** The fields a claim or a park writes, in the table's own column names. */
interface JobValues {
  status?: string;
  started_at?: string | null;
  finished_at?: string | null;
  error?: string | null;
  error_code?: string | null;
  stage?: string | null;
  negative_cached_until?: string | null;
}

/** A claim moves the heartbeat; a park clears it. */
function startStamp(values: JobValues): readonly string[] {
  return values.status === "running" ? ["started_at"] : [];
}

/**
 * Insert the work's row and return it when this caller created it. A `23505`
 * means another caller created the row between our two statements — a lost
 * race for the claim, not an error.
 */
async function createRow(
  query: CatalogPrisma, bangumiId: string, values: JobValues,
): Promise<StampedRow | null> {
  try {
    const [created] = await query.executor.query(insertPlan(query, bangumiId, values));
    return created ?? null;
  } catch (error) {
    if (isUniqueViolation(error)) return null;
    throw error;
  }
}

/**
 * The INSERT of the work's row. The heartbeat rule is the UPDATE's: only a claim
 * moves `started_at`. A parked row is created with it cleared, so a pending work
 * never reads as in flight.
 */
function insertPlan(query: CatalogPrisma, bangumiId: string, values: JobValues): SqlOrmPlan<StampedRow> {
  const insert = query.builder.public.ingest_jobs
    .insert([{ work_id: bangumiId, ...values }])
    .returning("work_id", "started_at")
    .build();
  const stamps = startStamp(values);
  return stamps.length === 0 ? insert : atServerNow(insert, stamps);
}

async function readGuard(query: CatalogPrisma, bangumiId: string): Promise<IngestGuard> {
  const [row] = await query.executor.query(guardPlan(query, bangumiId));
  if (row === undefined) return "ready";
  if (row.running_live) return "in_progress";
  if (!row.cache_live) return "ready";
  return row.error_code === "not_found" ? "empty" : "recently_attempted";
}

/** The live guard: the work's error code and its two liveness flags. */
function guardPlan(query: CatalogPrisma, bangumiId: string): SqlOrmPlan<GuardRow> {
  return query.builder.public.ingest_jobs
    .select((fields, fns) => ({
      error_code: fields.error_code,
      running_live: fns.raw`${fields.status} = 'running' and coalesce(${fields.started_at}, ${fields.created_at}) > now() - make_interval(secs => ${RUNNING_TTL_SECONDS})`.returns("pg/bool@1"),
      cache_live: fns.raw`${fields.negative_cached_until} > now()`.returns("pg/bool@1"),
    }))
    .where((fields, fns) => fns.eq(fields.work_id, bangumiId))
    .build();
}

/** Mark the claimed work done and clear its negative cache. */
function markDonePlan(query: CatalogPrisma, claim: JobClaim): SqlOrmPlan<{ work_id: string }> {
  const done = { status: "done", error: null, error_code: null, stage: null, negative_cached_until: null };
  return atServerNow(fencedUpdate(query, claim, done), ["finished_at"]);
}

/** Mark the claimed work failed and park it for the TTL. */
function markFailedPlan(
  query: CatalogPrisma, claim: JobClaim, opts: FailureOptions,
): SqlOrmPlan<{ work_id: string }> {
  const failed = { status: "failed", error: opts.error ?? null, error_code: opts.errorCode, stage: opts.stage ?? null };
  return atServerClock(fencedUpdate(query, claim, failed), {
    finished_at: 0,
    negative_cached_until: opts.ttlSeconds,
  });
}

/**
 * UPDATE the work's row only while it still carries this claim: running, under
 * the stamp the claim's acquire wrote. A reclaim restamps the row, so a stalled
 * holder's write matches nothing and returns no row.
 */
function fencedUpdate(query: CatalogPrisma, claim: JobClaim, values: JobValues): SqlOrmPlan<{ work_id: string }> {
  return query.builder.public.ingest_jobs
    .update(values)
    .where((fields, fns) => fns.and(
      fns.eq(fields.work_id, claim.workId),
      fns.eq(fields.status, "running"),
      fns.eq(fields.started_at, claim.startedAt),
    ))
    .returning("work_id")
    .build();
}

/** A fenced write that changed no row has lost its claim. */
function fencedOutcome(rows: readonly unknown[]): ClaimWrite {
  return rows.length > 0 ? "recorded" : "claim_lost";
}

/** One live refusal row for the source, if any: the refusal alarm's ledger. */
function liveRefusalPlan(query: CatalogPrisma, upstream: UpstreamName): SqlOrmPlan<{ work_id: string }> {
  return query.builder.public.ingest_jobs
    .select("work_id")
    .where((fields, fns) => fns.and(
      fns.eq(fields.error_code, IngestErrorCode.UpstreamRefused),
      fns.eq(fields.stage, fetchStage(upstream)),
      fns.raw`${fields.negative_cached_until} > now()`.returns("pg/bool@1"),
    ))
    .limit(1)
    .build();
}
