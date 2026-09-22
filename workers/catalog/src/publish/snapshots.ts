/**
 * Itinerary-snapshot storage over `itinerary_snapshots`
 * (the data-plane contract):
 *   id, bangumi_id, cluster_version, payload JSONB, created_at.
 *
 * A snapshot is bound to a specific cluster_version so an itinerary computed
 * against an old version keeps its exact payload after a newer version
 * publishes — shared itineraries never drift. The snapshot is intentionally
 * immutable per (bangumi_id, version) and survives version GC; the read path
 * keys on (bangumi_id, version).
 *
 * Statements are builder plans run on the request's runtime ({@link
 * CatalogPrisma}). `payload` is a JSON document and the column's codec type is
 * `JsonValue`, so the write crosses that boundary once, in
 * {@link asJsonValue} — the interface→index-signature gap, stated where it is
 * crossed rather than restated at every write.
 */
import type { SqlOrmPlan } from "@prisma/orm-postgres/relational-core/types";
import type { CatalogPrisma } from "../db/prisma";
import { asJsonValue } from "../lib/json";

/** A JSON-serializable itinerary snapshot payload. */
export type SnapshotPayload = Record<string, unknown> | unknown[];

/** INSERT an itinerary snapshot bound to (bangumi_id, version). */
export async function saveItinerarySnapshot(
  query: CatalogPrisma, bangumiId: string, version: number, payload: SnapshotPayload,
): Promise<void> {
  await query.executor.query(insertSnapshotPlan(query, bangumiId, version, payload));
}

/** The snapshot INSERT: bound to the version the itinerary was computed against. */
function insertSnapshotPlan(
  query: CatalogPrisma, bangumiId: string, version: number, payload: SnapshotPayload,
): SqlOrmPlan {
  return query.builder.public.itinerary_snapshots
    .insert([{ bangumi_id: bangumiId, cluster_version: version, payload: asJsonValue(payload) }])
    .build();
}

/** Read back the snapshot payload bound to (bangumi_id, version), or null. */
export async function getItinerarySnapshot(
  query: CatalogPrisma, bangumiId: string, version: number,
): Promise<SnapshotPayload | null> {
  const [row] = await query.executor.query(snapshotPlan(query, bangumiId, version));
  return row === undefined ? null : (row.payload as SnapshotPayload);
}

/** The work's snapshot at that version; the contract keeps one row per version. */
function snapshotPlan(query: CatalogPrisma, bangumiId: string, version: number): SqlOrmPlan<SnapshotRow> {
  return query.builder.public.itinerary_snapshots
    .select("payload")
    .where((fields, match) => match.and(
      match.eq(fields.bangumi_id, bangumiId),
      match.eq(fields.cluster_version, version),
    ))
    .orderBy("id", { direction: "desc" })
    .limit(1)
    .build();
}

/**
 * The one column this module reads back. Its codec decodes to `JsonValue` —
 * every JSON document — so the caller's narrower `SnapshotPayload` is stated at
 * the return rather than forced onto the plan every caller would then have to
 * agree with.
 */
interface SnapshotRow extends Record<string, unknown> {
  readonly payload: unknown;
}
