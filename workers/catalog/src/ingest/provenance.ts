/**
 * Source provenance (#1006 AC4): retain provenance, upstream identity, and
 * attribution/license metadata plus a field-level source map for every
 * upstream-derived entity.
 *
 * One row is UPSERTed per (scope, entity_id) into catalog_provenance. A point
 * row carries the Anitabi upstream identity (the point id itself), the Anitabi
 * source, and a per-field map recording which source produced each published
 * field. A work row carries the Bangumi subject provenance. Re-ingest of the
 * same entity overwrites the latest capture, so provenance never goes stale.
 *
 * The write is the builder's INSERT plus the conflict clause it does not model
 * ({@link ../db/plans}), on the (scope, entity_id) unique key. `captured_at` is
 * the column's own `now()` on both branches — the conflict side copies
 * `EXCLUDED.captured_at` — so the capture timestamp is the database's clock.
 */
import type { SqlOrmPlan } from "@prisma/orm-postgres/relational-core/types";
import type { CatalogPrisma } from "../db/prisma";
import { upsert } from "../db/plans";

/** The entity scope of a provenance record. */
export type ProvenanceScope = "point" | "work";

/** A field-level source map: published-field name -> contributing source. */
export type FieldSourceMap = Record<string, string>;

/** A provenance record ready for UPSERT. */
export interface ProvenanceRecord {
  scope: ProvenanceScope;
  entityId: string;
  workId: string;
  source: string;
  /** The upstream's own stable identity for the entity. */
  upstreamId: string | null;
  attribution: string | null;
  license: string | null;
  fieldMap: FieldSourceMap;
}

/** The columns a re-capture overwrites on an existing provenance row. */
const PROVENANCE_UPDATE_COLUMNS = [
  "work_id", "source", "upstream_id", "attribution", "license", "field_map", "captured_at",
] as const;

/** UPSERT a provenance record for an entity; latest capture wins. */
export async function captureProvenance(
  query: CatalogPrisma,
  record: ProvenanceRecord,
): Promise<void> {
  await query.executor.query(capturePlan(query, record));
}

/** The UPSERT ... ON CONFLICT (scope, entity_id) DO UPDATE plan. */
function capturePlan(query: CatalogPrisma, record: ProvenanceRecord): SqlOrmPlan {
  const insert = query.builder.public.catalog_provenance
    .insert([provenanceValues(record)])
    .build();
  return upsert(insert, { target: ["scope", "entity_id"], update: PROVENANCE_UPDATE_COLUMNS });
}

/** The column values for one provenance row (`captured_at` stays the column default). */
function provenanceValues(record: ProvenanceRecord) {
  return {
    scope: record.scope,
    entity_id: record.entityId,
    work_id: record.workId,
    source: record.source,
    upstream_id: record.upstreamId,
    attribution: record.attribution,
    license: record.license,
    field_map: record.fieldMap,
  };
}

/** A point's field-source map: every published point field comes from Anitabi. */
export function pointFieldMap(): FieldSourceMap {
  return Object.fromEntries(POINT_FIELDS.map((field) => [field, "anitabi"]));
}

/** The point row fields Anitabi contributes (the field-level source map keys). */
const POINT_FIELDS = [
  "id", "name", "name_cn", "latitude", "longitude", "image", "episode", "time_seconds",
  "origin", "origin_url",
] as const;
