import { rawSql } from '@prisma/orm-postgres/migration';
import { tableOid } from './table-oid.ts';

// A conversation and the turns reserved against it. Both tables came from
// `migrations/neon/20260826000004_agent.sql`; the Python agent that owned the rest of that
// domain retired with #1607, but `workers/edge/src` still reads and writes these two through
// `db.raw.sql` (admission/session-owner.ts, identity/session-adoption-store.ts,
// agent/views/conversation-list.ts). The data-plane contract does not declare them (spec
// §4.12) and `daily_usage`'s NUMERIC(14,6) has no PSL spelling at all (usage-meters.ts), so
// the chain installs both here instead — the same escape hatch the triggers, the descending
// indexes and the grant matrix already use.
//
// Only the columns a live reader or writer names survive the rebuild, the way §4.8.3 drops
// `points.embedding`: `state`, `metadata`, `lifecycle`, `expires_at` on `sessions` and
// `created_at`, `updated_at`, `lease_owner`, `lease_expires_at`, `request_digest`,
// `outcome_payload` on `turn_reservations` had no consumer outside the retired Python sweep,
// and `idx_sessions_lifecycle` / `idx_turn_reservations_sweep` indexed exactly those columns.
const SESSIONS_TABLE = `CREATE TABLE public.sessions (
    id text NOT NULL,
    user_id text,
    title text,
    first_query text,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now(),
    PRIMARY KEY (id)
  )`;

// `conversation-list.ts` orders by `updated_at DESC NULLS LAST`, which the contract IR cannot
// express — the same reason `idx_raw_payload_history_work_source` lives in data-plane-indexes.ts.
const SESSIONS_INDEXES = {
  idx_sessions_user: 'CREATE INDEX idx_sessions_user ON public.sessions (user_id)',
  idx_sessions_user_updated: 'CREATE INDEX idx_sessions_user_updated ON public.sessions (user_id, updated_at DESC)',
};

// `turn_reservations_session_revision` is load-bearing BY NAME: the adoption statement writes
// `ON CONFLICT ON CONSTRAINT turn_reservations_session_revision`
// (workers/edge/src/identity/session-adoption-store.ts:43), so renaming it breaks adoption.
const TURN_RESERVATIONS_TABLE = `CREATE TABLE public.turn_reservations (
    id uuid NOT NULL DEFAULT uuidv7(),
    session_id text,
    turn_key text NOT NULL,
    payer text NOT NULL,
    identity_id text,
    revision integer NOT NULL,
    digest text,
    status text NOT NULL DEFAULT 'reserved',
    PRIMARY KEY (id),
    CONSTRAINT turn_reservations_session_revision UNIQUE (session_id, revision),
    CONSTRAINT turn_reservations_session_turn_key UNIQUE (session_id, turn_key),
    CONSTRAINT turn_reservations_payer_check CHECK (payer IN ('anon', 'user', 'byok')),
    CONSTRAINT turn_reservations_status_check CHECK (status IN ('reserved', 'running', 'completed', 'failed'))
  )`;

const TURN_RESERVATIONS_INDEXES = {
  idx_turn_reservations_session_revision:
    'CREATE INDEX idx_turn_reservations_session_revision ON public.turn_reservations (session_id, revision DESC)',
  turn_reservations_null_session_key:
    'CREATE UNIQUE INDEX turn_reservations_null_session_key ON public.turn_reservations (turn_key) WHERE session_id IS NULL',
};

/** One `CREATE INDEX` step, described by the index it creates. */
const indexSteps = (statements: Record<string, string>) =>
  Object.entries(statements).map(([index, sql]) => ({ description: `create index ${index}`, sql }));

/** The exact column set one table carries, so a dropped or added column fails by name. */
const columnSet = (table: string, columns: readonly string[]) => `SELECT (
    SELECT array_agg(column_name::text ORDER BY column_name::text)
    FROM information_schema.columns WHERE table_schema = 'public' AND table_name = '${table}'
  ) = ARRAY['${[...columns].sort().join("','")}']::text[] AS result`;

/** One index's own `pg_indexes` definition, matched on the semantics the IR cannot read. */
const indexDefinition = (index: string, fragment: string) =>
  `SELECT indexdef LIKE '%${fragment}%' AS result FROM pg_indexes WHERE schemaname = 'public' AND indexname = '${index}'`;

/** One constraint by its physical name — the form `ON CONFLICT ON CONSTRAINT` depends on. */
const constraintByName = (table: string, constraint: string, type: string) =>
  `SELECT EXISTS (SELECT 1 FROM pg_constraint
    WHERE conrelid = ${tableOid(table)} AND conname = '${constraint}' AND contype = '${type}') AS result`;

export const CONVERSATION_LEDGER_TABLES = ['sessions', 'turn_reservations'] as const;

export const CONVERSATION_LEDGER = rawSql({
  id: 'conversation-ledger',
  label: 'Create the conversation ledger the agent tier writes',
  operationClass: 'additive',
  target: { id: 'postgres' },
  precheck: [],
  execute: [
    { description: 'create the sessions table', sql: SESSIONS_TABLE },
    ...indexSteps(SESSIONS_INDEXES),
    { description: 'create the turn_reservations table', sql: TURN_RESERVATIONS_TABLE },
    ...indexSteps(TURN_RESERVATIONS_INDEXES),
  ],
  postcheck: [{
    description: 'verify the sessions table carries exactly the columns its readers name',
    sql: columnSet('sessions', ['id', 'user_id', 'title', 'first_query', 'created_at', 'updated_at']),
  }, {
    description: 'verify idx_sessions_user indexes the owner predicate',
    sql: indexDefinition('idx_sessions_user', '(user_id)'),
  }, {
    description: 'verify idx_sessions_user_updated orders updated_at descending',
    sql: indexDefinition('idx_sessions_user_updated', '(user_id, updated_at DESC)'),
  }, {
    description: 'verify the turn_reservations table carries exactly the columns its readers name',
    sql: columnSet('turn_reservations', ['id', 'session_id', 'turn_key', 'payer', 'identity_id', 'revision', 'digest', 'status']),
  }, {
    description: 'verify turn_reservations_session_revision exists under the name adoption conflicts on',
    sql: constraintByName('turn_reservations', 'turn_reservations_session_revision', 'u'),
  }, {
    description: 'verify turn_reservations_session_turn_key keeps one reservation per turn key',
    sql: constraintByName('turn_reservations', 'turn_reservations_session_turn_key', 'u'),
  }, {
    description: 'verify idx_turn_reservations_session_revision orders revision descending',
    sql: indexDefinition('idx_turn_reservations_session_revision', '(session_id, revision DESC)'),
  }, {
    description: 'verify turn_reservations_null_session_key keeps session-less turn keys unique',
    sql: indexDefinition('turn_reservations_null_session_key', 'WHERE (session_id IS NULL)'),
  }],
});
