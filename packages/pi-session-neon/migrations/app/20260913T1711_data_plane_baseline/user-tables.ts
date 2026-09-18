import { checkExpression, col, fn, lit, primaryKey } from '@prisma/orm-postgres/migration';

export const USER_TABLES = [{
  schema: 'public', table: 'saved_route_anime',
  columns: [
    col('bangumi_id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
    col('position', 'int4', { notNull: true, default: lit(0), codecRef: { codecId: 'pg/int4@1' } }),
    col('saved_route_id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
  ],
  constraints: [primaryKey(['saved_route_id', 'bangumi_id'])],
}, {
  schema: 'public', table: 'saved_route_idempotency',
  columns: [
    col('created_at', 'timestamptz', { default: fn('now()'), codecRef: { codecId: 'pg/timestamptz-string@1' } }),
    col('expires_at', 'timestamptz', { notNull: true, codecRef: { codecId: 'pg/timestamptz-string@1' } }),
    col('fingerprint', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
    col('key', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
    col('op', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
    col('owner_user_id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
    col('result', 'jsonb', { codecRef: { codecId: 'pg/jsonb@1' } }),
    col('result_id', 'uuid', { codecRef: { codecId: 'pg/uuid@1' } }),
    col('state', 'text', { notNull: true, default: lit('in_progress'), codecRef: { codecId: 'pg/text@1' } }),
  ],
  constraints: [
    primaryKey(['owner_user_id', 'op', 'key']),
    checkExpression('saved_route_idempotency_state_c15286b9', "state IN ('in_progress', 'committed')"),
  ],
}, {
  schema: 'public', table: 'saved_routes',
  columns: [
    col('created_at', 'timestamptz', { default: fn('now()'), codecRef: { codecId: 'pg/timestamptz-string@1' } }),
    col('id', 'uuid', { notNull: true, default: fn('uuidv7()'), codecRef: { codecId: 'pg/uuid@1' } }),
    col('point_ids', 'text[]', { notNull: true, codecRef: { codecId: 'pg/text@1', many: true } }),
    col('saved_at', 'timestamptz', { codecRef: { codecId: 'pg/timestamptz-string@1' } }),
    col('status', 'text', { notNull: true, default: lit('draft'), codecRef: { codecId: 'pg/text@1' } }),
    col('title', 'text', { codecRef: { codecId: 'pg/text@1' } }),
    col('updated_at', 'timestamptz', { notNull: true, default: fn('now()'), codecRef: { codecId: 'pg/timestamptz-string@1' } }),
    col('user_id', 'text', { codecRef: { codecId: 'pg/text@1' } }),
  ],
  constraints: [
    primaryKey(['id']),
    checkExpression('saved_routes_status_a8464f30', "status IN ('draft', 'saved', 'completed')"),
  ],
}] as const;
