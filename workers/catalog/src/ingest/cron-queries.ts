/**
 * SQL for the scheduled ingest crons (S0-v2 D4).
 *
 * Two read queries over the raw zone + `ingest_jobs`:
 *   - listDoneWorkIds: the checked-in seed works that already carry a `done`
 *     ingest_jobs row — the daily seed pass skips them so re-runs are no-ops.
 *   - listStaleWorkIds: the works whose WEAKEST raw fetch is the OLDEST,
 *     capped at `cap`. A work is only fresh when both sources were fetched
 *     recently; a missing source row reads as infinitely old. Works behind a
 *     live failure negative-cache are excluded, and a TTL floor stops the
 *     refresh pass from re-picking everything every hour.
 *
 * Writes only flow through the existing pipeline (orchestrator/raw-store);
 * these reads go through raw `sql` execute, consistent with the ingest layer.
 */
import { sql, type SQL } from "drizzle-orm";
import type { CatalogDb } from "../db/client";

/** TTL freshness floor: works whose weakest fetch is younger than this are not stale. */
export const STALE_AFTER_SECONDS = 24 * 60 * 60;

let weakestFreshness: SQL | undefined;

/**
 * A work's freshness: the WEAKER of its two source fetches. A source with no
 * raw row at all reads as `-infinity`, so a missing source keeps the work
 * stale instead of hiding behind the other source's fresh fetch.
 *
 * Built lazily on first use, not at module top level: evaluating a `sql`
 * template during module evaluation crashes the *bundled* Worker runtime
 * (esbuild's lazy-ESM ordering leaves drizzle's StringChunk class in the TDZ
 * until its init module runs — the vitest pool evaluates unbundled modules
 * with correct ESM order, so only the deployed bundle ever sees it).
 */
function weakestFreshnessSql(): SQL {
  weakestFreshness ??= sql`
  LEAST(
    COALESCE(a.fetched_at, '-infinity'),
    COALESCE(b.fetched_at, '-infinity')
  )
`;
  return weakestFreshness;
}

/** Work ids with a `done` ingest_jobs row; empty input yields an empty set. */
export async function listDoneWorkIds(
  db: CatalogDb,
  workIds: readonly string[],
): Promise<ReadonlySet<string>> {
  if (workIds.length === 0) return new Set();
  const ids = sql.join(workIds.map((id) => sql`${id}`), sql`, `);
  const result = await db.execute(sql`
    SELECT work_id FROM ingest_jobs
    WHERE work_id IN (${ids}) AND status = 'done'
  `);
  return new Set(workIdsOf(result.rows));
}

/** The `cap` stalest works past the TTL floor; live negative caches are skipped. */
export async function listStaleWorkIds(
  db: CatalogDb,
  cap: number,
  maxAgeSeconds: number = STALE_AFTER_SECONDS,
): Promise<readonly string[]> {
  assertPositiveCap(cap);
  const rows = (await db.execute(staleWorksSql(cap, maxAgeSeconds))).rows;
  return workIdsOf(rows);
}

/** Stale-set query: staleness is the weaker source fetch (missing row = -infinity). */
function staleWorksSql(cap: number, maxAgeSeconds: number): SQL {
  return sql`
    SELECT staleness.work_id
    FROM (SELECT work_id, ${weakestFreshnessSql()} AS freshness
      FROM raw_anitabi a FULL OUTER JOIN raw_bangumi b USING (work_id)) staleness
    WHERE staleness.freshness < NOW() - make_interval(secs => ${maxAgeSeconds})
      AND NOT EXISTS (SELECT 1 FROM ingest_jobs j WHERE j.work_id = staleness.work_id AND j.negative_cached_until > NOW())
    ORDER BY staleness.freshness ASC
    LIMIT ${cap}
  `;
}

/** The cap is interpolated into a LIMIT clause — never interpolate raw input. */
function assertPositiveCap(cap: number): void {
  if (!Number.isInteger(cap) || cap < 1) throw new Error("cron batch cap must be a positive integer");
}

/** Coerce `work_id` rows (text under the neon driver) to plain strings. */
function workIdsOf(rows: readonly unknown[]): string[] {
  return rows.flatMap((row) => {
    if (row === null || typeof row !== "object" || !("work_id" in row)) return [];
    const id = row.work_id;
    return typeof id === "string" ? [id] : [];
  });
}
