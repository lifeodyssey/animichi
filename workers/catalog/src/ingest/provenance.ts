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
 * The write is the builder's multi-row INSERT plus the conflict clause it does
 * not model ({@link ../db/plans}), on the (scope, entity_id) unique key.
 * `captured_at` is the column's own `now()` on both branches — the conflict side
 * copies `EXCLUDED.captured_at` — so the capture timestamp is the database's
 * clock, one per statement.
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

/** The most values one statement can bind: the wire protocol counts them in 16 bits. */
const MAX_BOUND_VALUES = 65_535;

/** The values one row binds: every column {@link provenanceValues} sets. */
const VALUES_PER_ROW = 8;

/** The most rows one UPSERT carries before its bound values would pass the protocol's count. */
export const ROWS_PER_STATEMENT = Math.floor(MAX_BOUND_VALUES / VALUES_PER_ROW);

/**
 * UPSERT a capture's records, latest capture winning: one statement for every
 * {@link ROWS_PER_STATEMENT} rows, so a work's capture is one statement unless
 * it carries more rows than that.
 *
 * A key the capture lists twice keeps its last record, as two writes in a row
 * did. Postgres refuses a statement that updates one row twice (SQLSTATE
 * 21000), so a repeated key would otherwise fail every row beside it.
 *
 * A statement is all or nothing. When Postgres refuses one of its rows, none of
 * its rows is written, the rows an earlier capture wrote for those keys keep
 * their values, and the refusal reaches the caller as the driver raised it. The
 * statements are not one transaction: in a capture longer than one statement,
 * the statements before the refused one stay written.
 */
export async function captureProvenance(
  query: CatalogPrisma,
  records: readonly ProvenanceRecord[],
): Promise<void> {
  for (const rows of statementRows(latestByKey(records))) {
    await query.executor.query(capturePlan(query, rows));
  }
}

/** One record per (scope, entity_id): the last one the capture lists for it. */
function latestByKey(records: readonly ProvenanceRecord[]): ProvenanceRecord[] {
  return [...new Map(records.map((record) => [JSON.stringify([record.scope, record.entityId]), record])).values()];
}

/** The records cut into runs of at most {@link ROWS_PER_STATEMENT}, one run per statement. */
function statementRows(records: readonly ProvenanceRecord[]): ProvenanceRecord[][] {
  const statements = Math.ceil(records.length / ROWS_PER_STATEMENT);
  return Array.from({ length: statements }, (_, index) =>
    records.slice(index * ROWS_PER_STATEMENT, (index + 1) * ROWS_PER_STATEMENT));
}

/** The UPSERT ... ON CONFLICT (scope, entity_id) DO UPDATE plan for one statement's rows. */
function capturePlan(query: CatalogPrisma, records: readonly ProvenanceRecord[]): SqlOrmPlan {
  const insert = query.builder.public.catalog_provenance
    .insert(records.map(provenanceValues))
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
