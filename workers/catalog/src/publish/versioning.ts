/**
 * Atomic version publish over `cluster_version`
 * (`supabase/migrations/20260620230000_ingest_infrastructure.sql`):
 *   id, work_id, version, is_current, created_at, with the partial unique index
 *   `uq_cluster_version_one_current` (work_id) WHERE is_current.
 *
 * A publish is a blue/green pointer switch done in ONE transaction: flip any
 * current row to is_current=false, THEN insert the new row with is_current=true.
 * The flip-then-insert order is mandatory — insert-then-flip would momentarily
 * leave two current rows and violate the partial unique index. The transaction
 * makes the swap all-or-nothing, so a reader never sees zero or two current rows.
 *
 * Writes go through raw `sql` execute (the Drizzle read schema is query-only),
 * consistent with the ingest/raw-store cards owning all mutations.
 */
import { sql } from "drizzle-orm";
import type { CatalogDb, DbExecutor } from "../db/client";

/** Publish a new version for a work; returns the new version number. */
export async function publishVersion(db: CatalogDb, workId: string): Promise<number> {
  return db.transaction(async (tx) => {
    const next = await nextVersion(tx, workId);
    await flipCurrentOff(tx, workId);
    await insertCurrent(tx, workId, next);
    return next;
  });
}

/** Compute max(version)+1 for the work (1 when none exist yet). */
async function nextVersion(tx: DbExecutor, workId: string): Promise<number> {
  const rows = (
    await tx.execute(
      sql`SELECT COALESCE(MAX(version), 0) + 1 AS next FROM cluster_version WHERE work_id = ${workId}`,
    )
  ).rows as { next: number }[];
  return rows[0]?.next ?? 1;
}

/** Flip the work's current row (if any) to is_current=false. */
async function flipCurrentOff(tx: DbExecutor, workId: string): Promise<void> {
  await tx.execute(
    sql`UPDATE cluster_version SET is_current = FALSE WHERE work_id = ${workId} AND is_current`,
  );
}

/** Insert the new version as the single current row for the work. */
async function insertCurrent(tx: DbExecutor, workId: string, version: number): Promise<void> {
  await tx.execute(
    sql`INSERT INTO cluster_version (work_id, version, is_current) VALUES (${workId}, ${version}, TRUE)`,
  );
}
