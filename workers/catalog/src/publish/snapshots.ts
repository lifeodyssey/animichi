/**
 * Itinerary-snapshot storage over `itinerary_snapshots`
 * (`migrations/neon/20260809000017_table_itinerary_snapshots.sql`):
 *   id, bangumi_id, cluster_version, payload JSONB, created_at.
 *
 * A snapshot is bound to a specific cluster_version so an itinerary computed
 * against an old version keeps its exact payload after a newer version
 * publishes — shared itineraries never drift. The snapshot is intentionally
 * immutable per (bangumi_id, version) and survives version GC; the read path
 * keys on (bangumi_id, version).
 *
 * Statements are built with the Drizzle query builder + the typed expression
 * helpers, then executed through the single `CatalogDb` seam.
 */
import { and, desc, eq } from "drizzle-orm";
import type { CatalogDb } from "../db/client";
import { statementBuilder } from "../db/client";
import { itinerarySnapshots } from "../db/schema";

/** A JSON-serializable itinerary snapshot payload. */
export type SnapshotPayload = Record<string, unknown> | unknown[];

/** INSERT an itinerary snapshot bound to (bangumi_id, version). */
export async function saveItinerarySnapshot(
  db: CatalogDb, bangumiId: string, version: number, payload: SnapshotPayload,
): Promise<void> {
  const statement = statementBuilder()
    .insert(itinerarySnapshots)
    .values({ bangumiId, clusterVersion: version, payload: JSON.stringify(payload) })
    .getSQL();
  await db.execute(statement);
}

/** Read back the snapshot payload bound to (bangumi_id, version), or null. */
export async function getItinerarySnapshot(
  db: CatalogDb, bangumiId: string, version: number,
): Promise<SnapshotPayload | null> {
  const statement = statementBuilder()
    .select({ payload: itinerarySnapshots.payload })
    .from(itinerarySnapshots)
    .where(and(eq(itinerarySnapshots.bangumiId, bangumiId), eq(itinerarySnapshots.clusterVersion, version)))
    .orderBy(desc(itinerarySnapshots.id))
    .limit(1)
    .getSQL();
  const rows = (await db.execute(statement)).rows as { payload: SnapshotPayload }[];
  return rows[0]?.payload ?? null;
}
