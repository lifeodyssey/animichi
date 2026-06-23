/**
 * Route-snapshot storage over `route_snapshots`
 * (`supabase/migrations/20260620230000_ingest_infrastructure.sql`):
 *   id, work_id, cluster_version, payload JSONB, created_at.
 *
 * A snapshot is bound to a specific cluster_version so a route computed against
 * an old version keeps its exact payload after a newer version publishes — shared
 * routes never drift. The snapshot is intentionally immutable per (work_id,
 * version) and survives version GC; the read path keys on (work_id, version).
 *
 * Writes go through raw `sql` execute (the Drizzle read schema is query-only),
 * consistent with the ingest/raw-store and versioning cards owning all mutations.
 */
import { sql } from "drizzle-orm";
import type { CatalogDb } from "../db/client";

/** A JSON-serializable route snapshot payload. */
export type SnapshotPayload = Record<string, unknown> | unknown[];

/** UPSERT a route snapshot bound to (work_id, version) so it never drifts. */
export async function saveRouteSnapshot(
  db: CatalogDb,
  workId: string,
  version: number,
  payload: SnapshotPayload,
): Promise<void> {
  await db.execute(sql`
    INSERT INTO route_snapshots (work_id, cluster_version, payload)
    VALUES (${workId}, ${version}, ${JSON.stringify(payload)}::jsonb)
  `);
}

/** Read back the snapshot payload bound to (work_id, version), or null. */
export async function getRouteSnapshot(
  db: CatalogDb,
  workId: string,
  version: number,
): Promise<SnapshotPayload | null> {
  const rows = (
    await db.execute(sql`
      SELECT payload FROM route_snapshots
      WHERE work_id = ${workId} AND cluster_version = ${version}
      ORDER BY id DESC LIMIT 1
    `)
  ).rows as Array<{ payload: SnapshotPayload }>;
  return rows[0]?.payload ?? null;
}
