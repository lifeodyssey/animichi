import { rawSql } from '@prisma/orm-postgres/migration';

// Two catalog indexes carry PostgreSQL semantics Prisma's contract IR cannot express:
// the pg_trgm operator class on idx_location_aliases_trgm and the descending key on
// idx_raw_payload_history_work_source. The contract declares what schema verification
// can read (table, columns, access method); this operation installs the DDL
// migrations/neon handed over and proves the semantics in pg_catalog. Contract and
// live DDL therefore agree on the columns without dropping gin_trgm_ops or seq DESC.
const TRIGRAM_INDEX = `CREATE INDEX "idx_location_aliases_trgm"
  ON "public"."location_aliases" USING gin (alias_normalized gin_trgm_ops)`;

const HISTORY_INDEX = `CREATE INDEX "idx_raw_payload_history_work_source"
  ON "public"."raw_payload_history" (work_id, source, seq DESC)`;

// The `pg_indexes` row for one index name; each definition wraps it in its own predicate.
const INDEX_LOOKUP = (index: string) => `
  FROM pg_indexes
  WHERE schemaname = 'public' AND indexname = '${index}'`;

const TRIGRAM_INDEX_DEFINITION = `
  SELECT indexdef LIKE '%USING gin%' AND indexdef LIKE '%gin_trgm_ops%' AS result${INDEX_LOOKUP('idx_location_aliases_trgm')}`;

const HISTORY_INDEX_DEFINITION = `
  SELECT indexdef LIKE '%(work_id, source, seq DESC)%' AS result${INDEX_LOOKUP('idx_raw_payload_history_work_source')}`;

export const DATA_PLANE_INDEXES = rawSql({
  id: 'data-plane-indexes',
  label: 'Create the operator-class and descending catalog indexes',
  operationClass: 'additive',
  target: { id: 'postgres' },
  precheck: [],
  execute: [{
    description: 'create the trigram operator-class index on location_aliases',
    sql: TRIGRAM_INDEX,
  }, {
    description: 'create the descending history index on raw_payload_history',
    sql: HISTORY_INDEX,
  }],
  postcheck: [{
    description: 'verify idx_location_aliases_trgm still uses gin_trgm_ops',
    sql: TRIGRAM_INDEX_DEFINITION,
  }, {
    description: 'verify idx_raw_payload_history_work_source still orders seq descending',
    sql: HISTORY_INDEX_DEFINITION,
  }],
});
