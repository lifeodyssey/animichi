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
 */
import { sql, type SQL } from "drizzle-orm";
import type { CatalogDb } from "../db/client";
import { statementBuilder } from "../db/client";
import { catalogProvenance } from "../db/schema";

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

/** UPSERT a provenance record for an entity; latest capture wins. */
export async function captureProvenance(
  db: CatalogDb,
  record: ProvenanceRecord,
): Promise<void> {
  await db.execute(captureStatement(record));
}

/** The UPSERT ... ON CONFLICT (scope, entity_id) DO UPDATE statement. */
function captureStatement(record: ProvenanceRecord): SQL {
  return statementBuilder()
    .insert(catalogProvenance)
    .values(provenanceValues(record))
    .onConflictDoUpdate({
      target: [catalogProvenance.scope, catalogProvenance.entityId],
      set: {
        workId: sql`EXCLUDED.work_id`,
        source: sql`EXCLUDED.source`,
        upstreamId: sql`EXCLUDED.upstream_id`,
        attribution: sql`EXCLUDED.attribution`,
        license: sql`EXCLUDED.license`,
        fieldMap: sql`EXCLUDED.field_map`,
      },
    })
    .getSQL();
}

/** The column values for one provenance row. */
function provenanceValues(record: ProvenanceRecord) {
  return {
    scope: record.scope,
    entityId: record.entityId,
    workId: record.workId,
    source: record.source,
    upstreamId: record.upstreamId,
    attribution: record.attribution,
    license: record.license,
    fieldMap: JSON.stringify(record.fieldMap),
  };
}

/** A point's field-source map: every published point field comes from Anitabi. */
export function pointFieldMap(): FieldSourceMap {
  return Object.fromEntries(POINT_FIELDS.map((field) => [field, "anitabi"]));
}

/** The point row fields Anitabi contributes (the field-level source map keys). */
const POINT_FIELDS = [
  "id", "name", "name_cn", "latitude", "longitude", "image", "episode", "time_seconds",
] as const;
