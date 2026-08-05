/**
 * SQL for the scheduled ingest crons (S0-v2 D4).
 *
 * Two read queries over the raw zone + `ingest_jobs`:
 *   - listDoneWorkIds: the checked-in seed works that already carry a `done`
 *     ingest_jobs row — the daily seed pass skips them so re-runs are no-ops.
 *   - listStaleWorkIds: the works whose raw rows are the OLDEST, capped at
 *     `cap` — the hourly TTL pass re-ingests exactly these, so every raw
 *     payload is eventually refreshed without stampeding upstream.
 *
 * Writes only flow through the existing pipeline (orchestrator/raw-store);
 * these reads go through raw `sql` execute, consistent with the ingest layer.
 */
import { sql } from "drizzle-orm";
import type { CatalogDb } from "../db/client";

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

/**
 * The `cap` works with the oldest newest-fetch across both raw tables
 * (a work's freshness is the max of its raw_anitabi/raw_bangumi fetched_at).
 */
export async function listStaleWorkIds(db: CatalogDb, cap: number): Promise<readonly string[]> {
  assertPositiveCap(cap);
  const result = await db.execute(sql`
    SELECT work_id
    FROM (
      SELECT work_id, MAX(fetched_at) AS newest_fetch
      FROM (
        SELECT work_id, fetched_at FROM raw_anitabi
        UNION ALL
        SELECT work_id, fetched_at FROM raw_bangumi
      ) raw_rows
      GROUP BY work_id
    ) staleness
    ORDER BY staleness.newest_fetch ASC
    LIMIT ${cap}
  `);
  return workIdsOf(result.rows);
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
