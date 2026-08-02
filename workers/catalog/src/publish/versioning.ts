/**
 * Atomic version publish over `cluster_version`
 * (`db/migrations/20260623000001_init.sql`):
 *   id, work_id, version, is_current, created_at, with the partial unique index
 *   `uq_cluster_version_one_current` (work_id) WHERE is_current.
 *
 * A publish is a blue/green pointer switch done in ONE server-side batch
 * transaction: flip any current row to is_current=false, THEN insert the new row
 * with is_current=true. The flip-then-insert order is mandatory — reversing it
 * would momentarily leave two current rows and violate the partial unique index.
 * The batch makes the swap all-or-nothing, so a reader never sees zero or two
 * current rows.
 *
 * Writes go through raw `sql` execute (the Drizzle read schema is query-only),
 * consistent with the ingest/raw-store cards owning all mutations.
 */
import { sql, type SQL } from "drizzle-orm";
import type { CatalogDb } from "../db/client";

interface PublishedVersionRow extends Record<string, unknown> {
  version: number;
}

/** Publish a new version for a work; returns the new version number. */
export async function publishVersion(db: CatalogDb, workId: string): Promise<number> {
  const [flip, insert] = publishVersionStatements(workId);
  const [, inserted] = await db.batch([
    db.execute(flip),
    db.execute<PublishedVersionRow>(insert),
  ]);
  return readPublishedVersion(inserted);
}

/** Ordered flip + insert-select statements shared by standalone and enrich batches. */
export function publishVersionStatements(
  workId: string,
): readonly [SQL, SQL<PublishedVersionRow>] {
  return [flipCurrentOff(workId), insertCurrent(workId)];
}

/** Flip the work's current row (if any) to is_current=false. */
function flipCurrentOff(workId: string): SQL {
  return sql`UPDATE cluster_version SET is_current = FALSE WHERE work_id = ${workId} AND is_current`;
}

/** Atomically derive and insert max(version)+1 (1 when no row exists). */
function insertCurrent(workId: string): SQL<PublishedVersionRow> {
  return sql<PublishedVersionRow>`
    INSERT INTO cluster_version (work_id, version, is_current)
    SELECT ${workId}, COALESCE(MAX(version), 0) + 1, TRUE
    FROM cluster_version WHERE work_id = ${workId}
    RETURNING version
  `;
}

/** Read and validate the INSERT ... RETURNING version batch result. */
export function readPublishedVersion(result: { rows: unknown[] }): number {
  const row = result.rows[0];
  if (typeof row !== "object" || row === null || !("version" in row)) {
    throw new Error("publish batch returned no version");
  }
  if (typeof row.version !== "number") throw new Error("publish batch returned an invalid version");
  return row.version;
}
