import { rawSql } from '@prisma/orm-postgres/migration';
import { tableOid } from './table-oid.ts';

// The two daily meters the agent tier keeps: what the platform spent per scope, and how many
// messages one anonymous identity has reserved today. `migrations/neon/20260826000004_agent.sql`
// created them and `20260904000000_platform_usage_scope.sql` widened the scope vocabulary to
// four; `workers/edge/src/agent/{admission/reserve-quota,admission/void-unaccepted,
// settlement/settlement-accounting,host/native-authority}.ts` still read and write both.
//
// They stay out of the data-plane contract for two reasons, not one. Spec §4.12 keeps the
// agent domain out of it; independently, `cost_usd NUMERIC(14,6)` has no PSL spelling —
// Prisma 8 removed `@db.X(...)` (#1620), so a declared `Decimal` would be unconstrained
// `numeric` and settlement would stop rounding once at six decimal places
// (settlement-accounting.ts:54 states that as the destination's contract).
/** Every scope `chargeUsage` can produce: the three payers plus the platform's own share of a
 * BYOK turn (`migrations/neon/20260904000000_platform_usage_scope.sql`). */
const SETTLEMENT_SCOPES = ['anon', 'user', 'byok', 'platform'] as const;
const scopeList = SETTLEMENT_SCOPES.map((scope) => `'${scope}'`).join(', ');

const DAILY_USAGE_TABLE = `CREATE TABLE public.daily_usage (
    usage_date date NOT NULL,
    scope text NOT NULL,
    requests bigint NOT NULL DEFAULT 0,
    input_tokens bigint NOT NULL DEFAULT 0,
    output_tokens bigint NOT NULL DEFAULT 0,
    cost_usd numeric(14,6) NOT NULL DEFAULT 0,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (usage_date, scope),
    CONSTRAINT daily_usage_scope_check CHECK (scope IN (${scopeList}))
  )`;

const DAILY_USAGE_INDEX = 'CREATE INDEX idx_daily_usage_scope_date ON public.daily_usage (scope, usage_date DESC)';

const ANON_DAILY_MESSAGE_COUNT_TABLE = `CREATE TABLE public.anon_daily_message_count (
    usage_date date NOT NULL,
    anon_id text NOT NULL,
    message_count bigint NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (usage_date, anon_id)
  )`;

/** `atttypmod` carries NUMERIC's precision and scale as `((precision << 16) | scale) + 4`. */
const COST_PRECISION = `SELECT atttypmod = ((14 << 16) | 6) + 4 AS result
  FROM pg_attribute WHERE attrelid = ${tableOid('daily_usage')} AND attname = 'cost_usd'`;

/** Each declared scope must survive in PostgreSQL's own reprint of the check, so a dropped value
 * fails as loudly as a dropped constraint. The reprint keeps source order, not sort order, so the
 * assertion asks for one value at a time rather than matching the list as written. */
const SCOPE_VOCABULARY = `SELECT bool_and(pg_get_constraintdef(scope_check.oid) LIKE '%''' || scope || '''%') AS result
  FROM pg_constraint AS scope_check
  CROSS JOIN unnest(ARRAY[${scopeList}]) AS scope
  WHERE scope_check.conrelid = ${tableOid('daily_usage')} AND scope_check.conname = 'daily_usage_scope_check'`;

/** One table's primary-key column list, in key order. */
const primaryKeyColumns = (table: string, columns: readonly string[]) => `SELECT (
    SELECT array_agg(attribute.attname::text ORDER BY key.key_position)
    FROM pg_constraint AS key_constraint
    CROSS JOIN LATERAL unnest(key_constraint.conkey) WITH ORDINALITY AS key(column_number, key_position)
    JOIN pg_attribute AS attribute
      ON attribute.attrelid = key_constraint.conrelid AND attribute.attnum = key.column_number
    WHERE key_constraint.conrelid = ${tableOid(table)} AND key_constraint.contype = 'p'
  ) = ARRAY['${columns.join("','")}']::text[] AS result`;

export const USAGE_METER_TABLES = ['anon_daily_message_count', 'daily_usage'] as const;

export const USAGE_METERS = rawSql({
  id: 'usage-meters',
  label: 'Create the daily usage meters the agent tier keeps',
  operationClass: 'additive',
  target: { id: 'postgres' },
  precheck: [],
  execute: [
    { description: 'create the daily_usage table', sql: DAILY_USAGE_TABLE },
    { description: 'create index idx_daily_usage_scope_date', sql: DAILY_USAGE_INDEX },
    { description: 'create the anon_daily_message_count table', sql: ANON_DAILY_MESSAGE_COUNT_TABLE },
  ],
  postcheck: [{
    description: 'verify daily_usage is keyed by day and scope',
    sql: primaryKeyColumns('daily_usage', ['usage_date', 'scope']),
  }, {
    description: 'verify daily_usage.cost_usd still rounds once at NUMERIC(14,6)',
    sql: COST_PRECISION,
  }, {
    description: 'verify daily_usage_scope_check admits every scope settlement writes',
    sql: SCOPE_VOCABULARY,
  }, {
    description: 'verify idx_daily_usage_scope_date orders usage_date descending',
    sql: `SELECT indexdef LIKE '%(scope, usage_date DESC)%' AS result
      FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'idx_daily_usage_scope_date'`,
  }, {
    description: 'verify anon_daily_message_count is keyed by day and anonymous identity',
    sql: primaryKeyColumns('anon_daily_message_count', ['usage_date', 'anon_id']),
  }],
});
