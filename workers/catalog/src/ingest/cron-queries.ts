/**
 * SQL for the scheduled ingest crons (S0-v2 D4).
 *
 * Two read queries over the raw zone + `ingest_jobs`:
 *   - listDoneBangumiIds: the checked-in seed works that already carry a `done`
 *     ingest_jobs row — the daily seed pass skips them so re-runs are no-ops.
 *   - listStaleBangumiIds: the works whose WEAKEST raw fetch is the OLDEST,
 *     capped at `cap`. A work is only fresh when both sources were fetched
 *     recently; a missing source row reads as infinitely old. Works behind a
 *     live failure negative-cache are excluded, and a TTL floor stops the
 *     refresh pass from re-picking everything every hour.
 *
 * Reads are built with the Drizzle query builder + typed expression helpers over
 * the single CatalogDb seam; the crawl-stale query composes a FULL OUTER JOIN
 * source and a NOT EXISTS subfilter as builder subqueries.
 */
import { and, asc, eq, inArray, or, sql, type SQL } from "drizzle-orm";
import type { CatalogDb } from "../db/client";
import { statementBuilder } from "../db/client";
import { ingestJobs, rawAnitabi, rawBangumi } from "../db/schema";
import { expiredNegativeCache, staleRunningJob } from "./jobs";

/** TTL freshness floor: works whose weakest fetch is younger than this are not stale. */
export const STALE_AFTER_SECONDS = 24 * 60 * 60;

/** Work ids with a `done` ingest_jobs row; empty input yields an empty set. */
export async function listDoneBangumiIds(
  db: CatalogDb,
  bangumiIds: readonly string[],
): Promise<ReadonlySet<string>> {
  if (bangumiIds.length === 0) return new Set();
  const result = await db.execute(doneBangumiIdsStatement(bangumiIds));
  return new Set(bangumiIdsOf(result.rows));
}

/** Select the seeded works that already carry a `done` row. */
function doneBangumiIdsStatement(bangumiIds: readonly string[]): SQL {
  return statementBuilder()
    .select({ workId: ingestJobs.workId })
    .from(ingestJobs)
    .where(and(inArray(ingestJobs.workId, [...bangumiIds]), eq(ingestJobs.status, "done")))
    .getSQL();
}

/** The `cap` stalest works past the TTL floor; live negative caches are skipped. */
export async function listStaleBangumiIds(
  db: CatalogDb,
  cap: number,
  maxAgeSeconds: number = STALE_AFTER_SECONDS,
): Promise<readonly string[]> {
  assertPositiveCap(cap);
  const rows = (await db.execute(staleWorksStatement(cap, maxAgeSeconds))).rows;
  return bangumiIdsOf(rows);
}

/** Oldest request-parked work, bounded for one scheduled drain. */
export async function listDrainableBangumiIds(db: CatalogDb, cap: number): Promise<readonly string[]> {
  assertPositiveCap(cap);
  const rows = (await db.execute(drainableStatement(cap))).rows;
  return bangumiIdsOf(rows);
}

function drainableStatement(cap: number): SQL {
  return statementBuilder()
    .select({ workId: ingestJobs.workId })
    .from(ingestJobs)
    .where(drainableJob())
    .orderBy(asc(ingestJobs.createdAt))
    .limit(cap)
    .getSQL();
}

function drainableJob(): SQL | undefined {
  const pending = eq(ingestJobs.status, "pending");
  return or(pending, staleRunningJob(), retryableFailure());
}

function retryableFailure(): SQL | undefined {
  return and(eq(ingestJobs.status, "failed"), expiredNegativeCache());
}

/**
 * Stale-set query: staleness is the weaker source fetch (missing row = -infinity)
 * over a FULL OUTER JOIN of both raw sources, excluding works behind a live
 * negative cache. The LEAST freshness aggregate is an expression-helper fragment
 * composed into a builder subquery.
 * LIVE-NEON: the FULL OUTER JOIN + LEAST rendering can only be validated against a
 * real Postgres — needs live-Neon validation.
 */
function staleWorksStatement(cap: number, maxAgeSeconds: number): SQL {
  const staleness = statementBuilder()
    .select({
      workId: sql`CASE WHEN ${rawAnitabi.workId} IS NULL THEN ${rawBangumi.workId} ELSE ${rawAnitabi.workId} END`.as("work_id"),
      freshness: sql`LEAST(COALESCE(${rawAnitabi.fetchedAt}, '-infinity'), COALESCE(${rawBangumi.fetchedAt}, '-infinity'))`.as("freshness"),
    })
    .from(rawAnitabi)
    .fullJoin(rawBangumi, eq(rawAnitabi.workId, rawBangumi.workId))
    .as("staleness");
  return statementBuilder()
    .select({ workId: staleness.workId })
    .from(staleness)
    .where(
      and(
        sql`staleness.freshness < NOW() - make_interval(secs => ${maxAgeSeconds})`,
        // Correlated: skip only works whose OWN ingest job is under a live negative cache.
        sql`NOT EXISTS (SELECT 1 FROM ingest_jobs WHERE ingest_jobs.work_id = staleness.work_id AND ingest_jobs.negative_cached_until > NOW())`,
      ),
    )
    .orderBy(sql`staleness.freshness ASC`)
    .limit(cap)
    .getSQL();
}

/** The cap is interpolated into a LIMIT clause — never interpolate raw input. */
function assertPositiveCap(cap: number): void {
  if (!Number.isInteger(cap) || cap < 1) throw new Error("cron batch cap must be a positive integer");
}

/** Coerce `work_id` rows (text under the neon driver) to plain strings. */
function bangumiIdsOf(rows: readonly unknown[]): string[] {
  return rows.flatMap((row) => {
    if (row === null || typeof row !== "object" || !("work_id" in row)) return [];
    const id = row.work_id;
    return typeof id === "string" ? [id] : [];
  });
}
