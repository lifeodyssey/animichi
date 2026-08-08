/**
 * Itinerary-snapshot storage over `itinerary_snapshots`
 * (`migrations/neon/20260623000001_init.sql`, renamed by the #852 catalog
 * migration): id, bangumi_id, cluster_version, payload JSONB, created_at.
 *
 * A snapshot is bound to a specific cluster_version so an itinerary computed
 * against an old version keeps its exact payload after a newer version
 * publishes — shared itineraries never drift. The snapshot is intentionally
 * immutable per (bangumi_id, version) and survives version GC; the read path
 * keys on (bangumi_id, version).
 *
 * Writes go through raw `sql` execute (the Drizzle read schema is query-only),
 * consistent with the ingest/raw-store and versioning cards owning all mutations.
 */
import { sql } from "drizzle-orm";
import type { CatalogDb } from "../db/client";

/** A JSON-serializable itinerary snapshot payload. */
export type SnapshotPayload = Record<string, unknown> | unknown[];

/** UPSERT an itinerary snapshot bound to (bangumi_id, version) so it never drifts. */
export async function saveItinerarySnapshot(
  db: CatalogDb, bangumiId: string, version: number, payload: SnapshotPayload,
): Promise<void> {
  await db.execute(sql`
    INSERT INTO itinerary_snapshots (bangumi_id, cluster_version, payload)
    VALUES (${bangumiId}, ${version}, ${JSON.stringify(payload)}::jsonb)
  `);
}

/** Read back the snapshot payload bound to (bangumi_id, version), or null. */
export async function getItinerarySnapshot(
  db: CatalogDb, bangumiId: string, version: number,
): Promise<SnapshotPayload | null> {
  const rows = (await db.execute(sql`
      SELECT payload FROM itinerary_snapshots
      WHERE bangumi_id = ${bangumiId} AND cluster_version = ${version} ORDER BY id DESC LIMIT 1
    `)).rows as { payload: SnapshotPayload }[];
  return rows[0]?.payload ?? null;
}
