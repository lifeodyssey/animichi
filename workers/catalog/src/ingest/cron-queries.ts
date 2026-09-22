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
 * Reads are builder plans over the shared contract (#1630), so each projection
 * fixes the row to the column's own type and the `unknown[]` narrowing the
 * Drizzle seam needed has nowhere left to live. The staleness query is one
 * statement rather than the Drizzle path's derived table: the join the builder
 * states is already the grouping that table existed to provide.
 *
 * Every predicate is stated INSIDE its own callback. The field and function
 * proxies are the builder's, so a predicate lifted into a free function with
 * hand-written parameter types would be a second declaration of them rather than
 * a shared one — the two clock fragments below are therefore repeated at the two
 * call sites that need them, which is the cheaper of the two lies.
 */
import type { SqlOrmPlan } from "@prisma/orm-postgres/relational-core/types";
import type { CatalogPrisma } from "../db/prisma";
import { RUNNING_TTL_SECONDS } from "./jobs";

/** TTL freshness floor: works whose weakest fetch is younger than this are not stale. */
export const STALE_AFTER_SECONDS = 24 * 60 * 60;

/** Work ids with a `done` ingest_jobs row; empty input yields an empty set. */
export async function listDoneBangumiIds(
  query: CatalogPrisma,
  bangumiIds: readonly string[],
): Promise<ReadonlySet<string>> {
  if (bangumiIds.length === 0) return new Set();
  const rows = await query.executor.query(doneBangumiIdsPlan(query, bangumiIds));
  return new Set(rows.map((row) => row.work_id));
}

/** Select the seeded works that already carry a `done` row. */
function doneBangumiIdsPlan(
  query: CatalogPrisma, bangumiIds: readonly string[],
): SqlOrmPlan<{ work_id: string }> {
  return query.builder.public.ingest_jobs
    .select("work_id")
    .where((fields, match) => match.and(
      match.in(fields.work_id, [...bangumiIds]),
      match.eq(fields.status, "done"),
    ))
    .build();
}

/** The `cap` stalest works past the TTL floor; live negative caches are skipped. */
export async function listStaleBangumiIds(
  query: CatalogPrisma,
  cap: number,
  maxAgeSeconds: number = STALE_AFTER_SECONDS,
): Promise<readonly string[]> {
  assertPositiveCap(cap);
  const rows = await query.executor.query(staleWorksPlan(query, cap, maxAgeSeconds));
  return rows.map((row) => row.work_id);
}

/**
 * The stalest works: the FULL OUTER JOIN of both raw sources, ordered by the
 * weaker side's fetch time, with works behind a live negative cache excluded.
 *
 * `LEAST(COALESCE(…, '-infinity'), …)` is the "weaker source, missing = oldest"
 * ranking the TTL pass ranks on: a work with one source missing is infinitely
 * stale. The correlated NOT EXISTS is per work, so the exclusion follows the
 * work's OWN ingest job rather than any row the join happens to produce.
 */
function staleWorksPlan(
  query: CatalogPrisma, cap: number, maxAgeSeconds: number,
): SqlOrmPlan<{ work_id: string }> {
  const anitabi = query.builder.public.raw_anitabi;
  const bangumi = query.builder.public.raw_bangumi;
  return anitabi
    .outerFullJoin(bangumi, (fields, match) => match.eq(fields.raw_anitabi.work_id, fields.raw_bangumi.work_id))
    .select((fields, fns) => ({
      work_id: fns.raw`coalesce(${fields.raw_anitabi.work_id}, ${fields.raw_bangumi.work_id})`.returns("pg/text@1"),
    }))
    .where((fields, fns) => fns.and(
      fns.raw`least(coalesce(${fields.raw_anitabi.fetched_at}, '-infinity'), coalesce(${fields.raw_bangumi.fetched_at}, '-infinity')) < now() - make_interval(secs => ${maxAgeSeconds})`.returns("pg/bool@1"),
      fns.raw`not exists (select 1 from ingest_jobs where ingest_jobs.work_id = coalesce(${fields.raw_anitabi.work_id}, ${fields.raw_bangumi.work_id}) and ingest_jobs.negative_cached_until > now())`.returns("pg/bool@1"),
    ))
    .orderBy((fields, fns) => fns.raw`least(coalesce(${fields.raw_anitabi.fetched_at}, '-infinity'), coalesce(${fields.raw_bangumi.fetched_at}, '-infinity'))`.returns("pg/timestamptz-string@1"), { direction: "asc" })
    .limit(cap)
    .build();
}

/** Oldest request-parked work, bounded for one scheduled drain. */
export async function listDrainableBangumiIds(query: CatalogPrisma, cap: number): Promise<readonly string[]> {
  assertPositiveCap(cap);
  const rows = await query.executor.query(drainablePlan(query, cap));
  return rows.map((row) => row.work_id);
}

/**
 * The drainable set: parked work, work whose running claim went stale, and
 * failures whose negative cache has run out — oldest creation first.
 */
function drainablePlan(query: CatalogPrisma, cap: number): SqlOrmPlan<{ work_id: string }> {
  return query.builder.public.ingest_jobs
    .select("work_id")
    .where((fields, match) => match.or(
      match.eq(fields.status, "pending"),
      match.and(
        match.eq(fields.status, "running"),
        match.raw`coalesce(${fields.started_at}, ${fields.created_at}) <= now() - make_interval(secs => ${RUNNING_TTL_SECONDS})`.returns("pg/bool@1"),
      ),
      match.and(
        match.eq(fields.status, "failed"),
        match.raw`(${fields.negative_cached_until} is null or ${fields.negative_cached_until} <= now())`.returns("pg/bool@1"),
      ),
    ))
    .orderBy("created_at", { direction: "asc" })
    .limit(cap)
    .build();
}

/** The cap is a bound value — never interpolate raw input. */
function assertPositiveCap(cap: number): void {
  if (!Number.isInteger(cap) || cap < 1) throw new Error("cron batch cap must be a positive integer");
}
