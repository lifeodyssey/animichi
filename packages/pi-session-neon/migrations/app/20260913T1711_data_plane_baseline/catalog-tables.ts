import { checkExpression, col, fn, lit, primaryKey } from '@prisma/orm-postgres/migration';

const RAW_PAYLOAD_COLUMNS = [
  col('fetched_at', 'timestamptz', { notNull: true, default: fn('now()'), codecRef: { codecId: 'pg/timestamptz-string@1' } }),
  col('payload', 'jsonb', { notNull: true, codecRef: { codecId: 'pg/jsonb@1' } }),
  col('work_id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
] as const;

/** The shape `raw_anitabi` and `raw_bangumi` share: one upstream JSON blob per work, keyed by `work_id`. */
function rawPayloadTable(table: string) {
  return { schema: 'public', table, columns: RAW_PAYLOAD_COLUMNS, constraints: [primaryKey(['work_id'])] };
}

export const CATALOG_TABLES = [{
  schema: 'public', table: 'aliases',
  columns: [
    col('alias', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
    col('alias_normalized', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
    col('bangumi_id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
    col('id', 'uuid', { notNull: true, default: fn('uuidv7()'), codecRef: { codecId: 'pg/uuid@1' } }),
    col('priority', 'int4', { notNull: true, default: lit(0), codecRef: { codecId: 'pg/int4@1' } }),
    col('source', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
  ],
  constraints: [primaryKey(['id'])],
}, {
  schema: 'public', table: 'bangumi',
  columns: [
    col('air_date', 'text', { codecRef: { codecId: 'pg/text@1' } }),
    col('city', 'text', { codecRef: { codecId: 'pg/text@1' } }),
    col('cover_url', 'text', { codecRef: { codecId: 'pg/text@1' } }),
    col('created_at', 'timestamptz', { default: fn('now()'), codecRef: { codecId: 'pg/timestamptz-string@1' } }),
    col('eps_count', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
    col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
    col('platform', 'text', { codecRef: { codecId: 'pg/text@1' } }),
    col('points_count', 'int4', { default: lit(0), codecRef: { codecId: 'pg/int4@1' } }),
    col('primary_color', 'text', { codecRef: { codecId: 'pg/text@1' } }),
    col('rating', 'float4', { codecRef: { codecId: 'pg/float4@1' } }),
    col('summary', 'text', { codecRef: { codecId: 'pg/text@1' } }),
    col('title', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
    col('title_cn', 'text', { codecRef: { codecId: 'pg/text@1' } }),
    col('updated_at', 'timestamptz', { default: fn('now()'), codecRef: { codecId: 'pg/timestamptz-string@1' } }),
  ],
  constraints: [primaryKey(['id'])],
}, {
  schema: 'public', table: 'catalog_provenance',
  columns: [
    col('attribution', 'text', { codecRef: { codecId: 'pg/text@1' } }),
    col('captured_at', 'timestamptz', { notNull: true, default: fn('now()'), codecRef: { codecId: 'pg/timestamptz-string@1' } }),
    col('entity_id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
    col('field_map', 'jsonb', { codecRef: { codecId: 'pg/jsonb@1' } }),
    col('id', 'uuid', { notNull: true, default: fn('uuidv7()'), codecRef: { codecId: 'pg/uuid@1' } }),
    col('license', 'text', { codecRef: { codecId: 'pg/text@1' } }),
    col('scope', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
    col('source', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
    col('upstream_id', 'text', { codecRef: { codecId: 'pg/text@1' } }),
    col('work_id', 'text', { codecRef: { codecId: 'pg/text@1' } }),
  ],
  constraints: [primaryKey(['id'])],
}, {
  schema: 'public', table: 'catalog_runs',
  columns: [
    col('budget_used', 'jsonb', { codecRef: { codecId: 'pg/jsonb@1' } }),
    col('created_at', 'timestamptz', { notNull: true, default: fn('now()'), codecRef: { codecId: 'pg/timestamptz-string@1' } }),
    col('failures', 'jsonb', { codecRef: { codecId: 'pg/jsonb@1' } }),
    col('finished_at', 'timestamptz', { codecRef: { codecId: 'pg/timestamptz-string@1' } }),
    col('published_versions', 'jsonb', { codecRef: { codecId: 'pg/jsonb@1' } }),
    col('run_id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
    col('source_outcomes', 'jsonb', { codecRef: { codecId: 'pg/jsonb@1' } }),
    col('started_at', 'timestamptz', { codecRef: { codecId: 'pg/timestamptz-string@1' } }),
    col('status', 'text', { notNull: true, default: lit('pending'), codecRef: { codecId: 'pg/text@1' } }),
    col('targets', 'jsonb', { codecRef: { codecId: 'pg/jsonb@1' } }),
  ],
  constraints: [primaryKey(['run_id'])],
}, {
  schema: 'public', table: 'cluster_version',
  columns: [
    col('bangumi_id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
    col('created_at', 'timestamptz', { notNull: true, default: fn('now()'), codecRef: { codecId: 'pg/timestamptz-string@1' } }),
    col('id', 'uuid', { notNull: true, default: fn('uuidv7()'), codecRef: { codecId: 'pg/uuid@1' } }),
    col('is_current', 'bool', { notNull: true, default: lit(false), codecRef: { codecId: 'pg/bool@1' } }),
    col('version', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
  ],
  constraints: [primaryKey(['id'])],
}, {
  schema: 'public', table: 'ingest_jobs',
  columns: [
    col('created_at', 'timestamptz', { notNull: true, default: fn('now()'), codecRef: { codecId: 'pg/timestamptz-string@1' } }),
    col('error', 'text', { codecRef: { codecId: 'pg/text@1' } }),
    col('error_code', 'text', { codecRef: { codecId: 'pg/text@1' } }),
    col('finished_at', 'timestamptz', { codecRef: { codecId: 'pg/timestamptz-string@1' } }),
    col('negative_cached_until', 'timestamptz', { codecRef: { codecId: 'pg/timestamptz-string@1' } }),
    col('stage', 'text', { codecRef: { codecId: 'pg/text@1' } }),
    col('started_at', 'timestamptz', { codecRef: { codecId: 'pg/timestamptz-string@1' } }),
    col('status', 'text', { notNull: true, default: lit('pending'), codecRef: { codecId: 'pg/text@1' } }),
    col('work_id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
  ],
  constraints: [primaryKey(['work_id'])],
}, {
  schema: 'public', table: 'itinerary_snapshots',
  columns: [
    col('bangumi_id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
    col('cluster_version', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
    col('created_at', 'timestamptz', { notNull: true, default: fn('now()'), codecRef: { codecId: 'pg/timestamptz-string@1' } }),
    col('id', 'uuid', { notNull: true, default: fn('uuidv7()'), codecRef: { codecId: 'pg/uuid@1' } }),
    col('payload', 'jsonb', { notNull: true, codecRef: { codecId: 'pg/jsonb@1' } }),
  ],
  constraints: [primaryKey(['id'])],
}, {
  schema: 'public', table: 'leg_cache',
  columns: [
    col('created_at', 'timestamptz', { notNull: true, default: fn('now()'), codecRef: { codecId: 'pg/timestamptz-string@1' } }),
    col('distance_m', 'float8', { codecRef: { codecId: 'pg/float8@1' } }),
    col('duration_minutes', 'float8', { codecRef: { codecId: 'pg/float8@1' } }),
    col('from_cluster', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
    col('mode', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
    col('to_cluster', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
  ],
  constraints: [primaryKey(['from_cluster', 'to_cluster', 'mode'])],
}, {
  schema: 'public', table: 'location_aliases',
  columns: [
    col('alias', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
    col('alias_normalized', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
    col('lang', 'text', { codecRef: { codecId: 'pg/text@1' } }),
    col('location_id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
    col('priority', 'int4', { notNull: true, default: lit(0), codecRef: { codecId: 'pg/int4@1' } }),
  ],
  constraints: [
    primaryKey(['alias_normalized', 'location_id']),
    checkExpression('location_aliases_lang_2d53ab68', "lang IS NULL OR lang IN ('ja', 'zh', 'en')"),
  ],
}, {
  schema: 'public', table: 'locations',
  columns: [
    col('created_at', 'timestamptz', { default: fn('now()'), codecRef: { codecId: 'pg/timestamptz-string@1' } }),
    col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
    col('kind', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
    col('latitude', 'float8', { notNull: true, codecRef: { codecId: 'pg/float8@1' } }),
    col('longitude', 'float8', { notNull: true, codecRef: { codecId: 'pg/float8@1' } }),
    col('name', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
    col('pref', 'text', { codecRef: { codecId: 'pg/text@1' } }),
    col('source', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
    col('updated_at', 'timestamptz', { default: fn('now()'), codecRef: { codecId: 'pg/timestamptz-string@1' } }),
  ],
  constraints: [
    primaryKey(['id']),
    checkExpression('locations_kind_896a2215', "kind IN ('station', 'city', 'ward', 'landmark', 'prefecture')"),
    checkExpression('locations_source_d0ccedf5', "source IN ('seed', 'mlit', 'geonames', 'manual')"),
  ],
}, {
  schema: 'public', table: 'media_assets',
  columns: [
    col('content_hash', 'text', { codecRef: { codecId: 'pg/text@1' } }),
    col('last_origin_pull', 'timestamptz', { codecRef: { codecId: 'pg/timestamptz-string@1' } }),
    col('point_id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
    col('r2_key', 'text', { codecRef: { codecId: 'pg/text@1' } }),
    col('tombstoned', 'bool', { notNull: true, default: lit(false), codecRef: { codecId: 'pg/bool@1' } }),
  ],
  constraints: [primaryKey(['point_id'])],
}, {
  schema: 'public', table: 'points',
  columns: [
    col('bangumi_id', 'text', { codecRef: { codecId: 'pg/text@1' } }),
    col('city', 'text', { codecRef: { codecId: 'pg/text@1' } }),
    col('created_at', 'timestamptz', { default: fn('now()'), codecRef: { codecId: 'pg/timestamptz-string@1' } }),
    col('episode', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
    col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
    col('image', 'text', { codecRef: { codecId: 'pg/text@1' } }),
    col('latitude', 'float8', { notNull: true, codecRef: { codecId: 'pg/float8@1' } }),
    col('location', 'geography(Point,4326)', { notNull: true, codecRef: { codecId: 'pg/geography@1', typeParams: { srid: 4326 } } }),
    col('longitude', 'float8', { notNull: true, codecRef: { codecId: 'pg/float8@1' } }),
    col('name', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
    col('name_cn', 'text', { codecRef: { codecId: 'pg/text@1' } }),
    col('origin', 'text', { codecRef: { codecId: 'pg/text@1' } }),
    col('origin_url', 'text', { codecRef: { codecId: 'pg/text@1' } }),
    col('scene_desc', 'text', { codecRef: { codecId: 'pg/text@1' } }),
    col('time_seconds', 'int4', { default: lit(0), codecRef: { codecId: 'pg/int4@1' } }),
    col('updated_at', 'timestamptz', { default: fn('now()'), codecRef: { codecId: 'pg/timestamptz-string@1' } }),
  ],
  constraints: [primaryKey(['id'])],
}, rawPayloadTable('raw_anitabi'), rawPayloadTable('raw_bangumi'), {
  schema: 'public', table: 'raw_payload_history',
  columns: [
    col('fetched_at', 'timestamptz', { notNull: true, default: fn('now()'), codecRef: { codecId: 'pg/timestamptz-string@1' } }),
    col('payload', 'jsonb', { notNull: true, codecRef: { codecId: 'pg/jsonb@1' } }),
    col('run_id', 'text', { codecRef: { codecId: 'pg/text@1' } }),
    col('seq', 'BIGSERIAL', { notNull: true, codecRef: { codecId: 'pg/int8number@1' } }),
    col('source', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
    col('work_id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
  ],
  constraints: [primaryKey(['seq'])],
}, {
  schema: 'public', table: 'series_edges',
  columns: [
    col('from_bangumi_id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
    col('relation', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
    col('to_bangumi_id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
  ],
  constraints: [primaryKey(['from_bangumi_id', 'to_bangumi_id', 'relation'])],
}] as const;
