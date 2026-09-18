import { rawSql } from '@prisma/orm-postgres/migration';
import { AGENT_TABLES } from './agent-tables.ts';
import { CATALOG_TABLES } from './catalog-tables.ts';
import { CONVERSATION_LEDGER_TABLES } from './conversation-ledger.ts';
import { NATIVE_TABLES } from './native-tables.ts';
import { USAGE_METER_TABLES } from './usage-meters.ts';
import { USER_TABLES } from './user-tables.ts';

// Grant names are derived from the single table definitions, so a new table cannot
// drift out of the matrix. `ingest_jobs` is job-owned (never readonly); `pi_records`
// is append-only history and is granted separately below.
const catalogTableNames = CATALOG_TABLES.map(({ table }) => table);
const catalogReadTableNames = catalogTableNames.filter((table) => table !== 'ingest_jobs');
const userTableNames = USER_TABLES.map(({ table }) => table);
const nativeMutableTableNames = [...NATIVE_TABLES, ...AGENT_TABLES]
  .map(({ table }) => table)
  .filter((table) => table !== 'pi_records');

const qualify = (tables: readonly string[]) => tables.map((table) => `public.${table}`).join(', ');
const catalogTables = qualify(catalogTableNames);
const catalogReadTables = qualify(catalogReadTableNames);
const userTables = qualify(userTableNames);
const nativeMutableTables = qualify(nativeMutableTableNames);

const MUTABLE_GRANTS = ['DELETE', 'INSERT', 'SELECT', 'UPDATE'] as const;
const APPEND_ONLY_GRANTS = ['INSERT', 'SELECT'] as const;
/** Settlement accumulates a day's totals and never removes one, so `daily_usage` has no DELETE. */
const ACCUMULATING_GRANTS = ['INSERT', 'SELECT', 'UPDATE'] as const;

/** The agent tier's ledger and meters (`conversation-ledger.ts`, `usage-meters.ts`). They are
 * raw-SQL objects rather than contract tables, so the type below — not a table definition —
 * is what stops one drifting out of the matrix: adding a table there without a grant here is
 * a compile error. `agent_svc` owns all four; `jobs_svc` retains the two the retention sweep
 * clears, and `readonly` reads the turn ledger, exactly as the chain this one replaced did. */
type LedgerTable = (typeof CONVERSATION_LEDGER_TABLES)[number] | (typeof USAGE_METER_TABLES)[number];
const AGENT_LEDGER_GRANTS: Record<LedgerTable, readonly string[]> = {
  anon_daily_message_count: MUTABLE_GRANTS,
  daily_usage: ACCUMULATING_GRANTS,
  sessions: MUTABLE_GRANTS,
  turn_reservations: MUTABLE_GRANTS,
};
const ledgerGrantEntries = Object.entries(AGENT_LEDGER_GRANTS);

interface GrantPostcheckStep {
  readonly description: string;
  readonly sql: string;
}

/** An exact-set assertion over the grants `information_schema.role_table_grants`
 * reports for `agent_svc` on one table. That view explodes the table's own ACL,
 * so it lists explicit grants only: `neon_superuser` membership, and the
 * `pg_write_all_data` privileges that membership carries, add no row. The check
 * therefore measures whether the migration's GRANT took effect; it cannot say
 * what `agent_svc` is able to do (#1591(b)). `note` only shapes the failure
 * text, which names the table and the privileges a reader has to compare. */
function grantPostcheck(table: string, grants: readonly string[], note = ''): GrantPostcheckStep {
  const expected = grants.map((grant) => `'${grant}'`).join(', ');
  const observed = `COALESCE((SELECT array_agg(DISTINCT privilege_type::text ORDER BY privilege_type::text) FROM information_schema.role_table_grants WHERE grantee = 'agent_svc' AND table_schema = 'public' AND table_name = '${table}'), ARRAY[]::text[])`;
  return {
    description: `verify agent_svc's explicit grants on ${table} are exactly ${grants.join(', ')}${note}`,
    sql: `SELECT (${observed}) = ARRAY[${expected}]::text[] AS result`,
  };
}

export const DATA_PLANE_ACCESS = rawSql({
  id: 'data-plane-access',
  label: 'Grant data-plane service access',
  operationClass: 'additive',
  target: { id: 'postgres' },
  precheck: [{
    description: 'require the existing data-plane service roles',
    sql: `SELECT count(*) = 5 AS result
      FROM pg_roles
      WHERE rolname IN ('agent_svc', 'catalog_svc', 'jobs_svc', 'readonly', 'users_svc')`,
  }],
  execute: [{
    description: 'grant public schema usage to data-plane roles',
    sql: 'GRANT USAGE ON SCHEMA public TO agent_svc, catalog_svc, jobs_svc, readonly, users_svc',
  }, {
    description: 'grant catalog service table access',
    sql: `GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE ${catalogTables} TO catalog_svc`,
  }, {
    description: 'grant readonly catalog table access',
    sql: `GRANT SELECT ON TABLE ${catalogReadTables} TO readonly`,
  }, {
    description: 'grant users service table access',
    sql: `GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE ${userTables} TO users_svc`,
  }, {
    description: 'grant readonly user table access',
    sql: `GRANT SELECT ON TABLE ${userTables} TO readonly`,
  }, {
    description: 'grant mutable native agent table access',
    sql: `GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE ${nativeMutableTables} TO agent_svc`,
  }, {
    description: 'grant append-only native history access',
    sql: 'GRANT SELECT, INSERT ON TABLE public.pi_records TO agent_svc',
  }, {
    description: 'grant agent catalog read access',
    sql: 'GRANT SELECT ON TABLE public.bangumi, public.points, public.saved_routes TO agent_svc',
  }, {
    description: 'grant jobs route read access',
    sql: 'GRANT SELECT ON TABLE public.saved_routes TO jobs_svc',
  }, ...ledgerGrantEntries.map(([table, grants]) => ({
    description: `grant agent service access to ${table}`,
    sql: `GRANT ${grants.join(', ')} ON TABLE public.${table} TO agent_svc`,
  })), {
    description: 'grant jobs retention access to the conversation and anonymous meters',
    sql: 'GRANT SELECT, DELETE ON TABLE public.sessions, public.anon_daily_message_count TO jobs_svc',
  }, {
    description: 'grant readonly turn ledger access',
    sql: 'GRANT SELECT ON TABLE public.turn_reservations TO readonly',
  }, {
    description: 'grant catalog history sequence access',
    sql: 'GRANT SELECT, USAGE ON SEQUENCE public.raw_payload_history_seq_seq TO catalog_svc',
  }],
  postcheck: [
    ...nativeMutableTableNames.map((table) => grantPostcheck(table, MUTABLE_GRANTS)),
    grantPostcheck('pi_records', APPEND_ONLY_GRANTS, ' (no UPDATE or DELETE grants)'),
    ...ledgerGrantEntries.map(([table, grants]) =>
      grantPostcheck(table, grants, table === 'daily_usage' ? ' (no DELETE grant)' : '')),
    {
      description: 'verify the data-plane grant matrix',
      sql: `SELECT has_schema_privilege('agent_svc', 'public', 'USAGE')
      AND has_schema_privilege('catalog_svc', 'public', 'USAGE')
      AND has_schema_privilege('jobs_svc', 'public', 'USAGE')
      AND has_schema_privilege('readonly', 'public', 'USAGE')
      AND has_schema_privilege('users_svc', 'public', 'USAGE')
      AND (SELECT bool_and(has_table_privilege('catalog_svc', table_name, 'SELECT')
        AND has_table_privilege('catalog_svc', table_name, 'INSERT')
        AND has_table_privilege('catalog_svc', table_name, 'UPDATE')
        AND has_table_privilege('catalog_svc', table_name, 'DELETE'))
        FROM unnest(ARRAY['${catalogTableNames.join("','")}']) AS table_name)
      AND (SELECT bool_and(has_table_privilege('readonly', table_name, 'SELECT'))
        FROM unnest(ARRAY['${catalogReadTableNames.join("','")}']) AS table_name)
      AND (SELECT bool_and(has_table_privilege('users_svc', table_name, 'SELECT')
        AND has_table_privilege('users_svc', table_name, 'INSERT')
        AND has_table_privilege('users_svc', table_name, 'UPDATE')
        AND has_table_privilege('users_svc', table_name, 'DELETE'))
        FROM unnest(ARRAY['${userTableNames.join("','")}']) AS table_name)
      AND (SELECT bool_and(has_table_privilege('readonly', table_name, 'SELECT'))
        FROM unnest(ARRAY['${userTableNames.join("','")}']) AS table_name)
      AND has_table_privilege('agent_svc', 'public.bangumi', 'SELECT')
      AND has_table_privilege('agent_svc', 'public.points', 'SELECT')
      AND has_table_privilege('agent_svc', 'public.saved_routes', 'SELECT')
      AND has_table_privilege('jobs_svc', 'public.saved_routes', 'SELECT')
      AND has_sequence_privilege('catalog_svc', 'public.raw_payload_history_seq_seq', 'SELECT')
      AND has_sequence_privilege('catalog_svc', 'public.raw_payload_history_seq_seq', 'USAGE') AS result`,
    },
  ],
});
