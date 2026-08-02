/**
 * Version garbage collection over `cluster_version`
 * (`db/migrations/20260623000001_init.sql`).
 *
 * Keeps the newest `keep` versions for a work and deletes the rest. The current
 * row (is_current=true) is NEVER deleted, even if it falls outside the keep
 * window — the live pointer must always survive. Route snapshots are not touched:
 * they are immutable and intentionally outlive their version (no-drift), so a GC'd
 * version's snapshot still reads back unchanged.
 *
 * Writes go through raw `sql` execute (the Drizzle read schema is query-only),
 * consistent with the versioning/snapshots cards owning all mutations.
 */
import { sql } from "drizzle-orm";
import type { CatalogDb } from "../db/client";

/** Delete non-current versions older than the newest `keep`; returns count deleted. */
export async function gcOldVersions(
  db: CatalogDb,
  workId: string,
  keep: number,
): Promise<number> {
  if (keep < 1) throw new Error("keep must be >= 1");
  const rows = (
    await db.execute(sql`
      DELETE FROM cluster_version
      WHERE work_id = ${workId}
        AND NOT is_current
        AND version < (
          SELECT MIN(version) FROM (
            SELECT version FROM cluster_version
            WHERE work_id = ${workId}
            ORDER BY version DESC LIMIT ${keep}
          ) AS kept
        )
      RETURNING id
    `)
  ).rows as { id: number }[];
  return rows.length;
}
