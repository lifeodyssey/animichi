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
/** The catalog tables the agent tier reads and never writes. */
const AGENT_CATALOG_READ_TABLES = ['bangumi', 'points', 'saved_routes'] as const;

const qualify = (tables: readonly string[]) => tables.map((table) => `public.${table}`).join(', ');

const MUTABLE_GRANTS = ['DELETE', 'INSERT', 'SELECT', 'UPDATE'] as const;
const SELECT_ONLY_GRANTS = ['SELECT'] as const;
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
 * reports for one `grantee` on one table. That view explodes the table's own ACL,
 * so it lists explicit grants only: `neon_superuser` membership, and the
 * `pg_write_all_data` privileges that membership carries, add no row. The check
 * therefore measures whether the migration's GRANT took effect; it cannot say
 * what the grantee is able to do (#1591(b)). `note` only shapes the failure
 * text, which names the grantee, the table and the privileges a reader has to
 * compare.
 *
 * `grantee` is part of the signature because a table is granted to several roles
 * at once — `saved_routes` to `users_svc`, `readonly`, `agent_svc` and `jobs_svc`,
 * `bangumi` and `points` to `catalog_svc` as well as `agent_svc`. One assertion
 * per table would compare whichever role the helper happened to name against the
 * other roles' ACLs, and a failure would say which table diverged without saying
 * whose grant is missing. */
function grantPostcheck(grantee: string, table: string, grants: readonly string[], note = ''): GrantPostcheckStep {
  const expected = grants.map((grant) => `'${grant}'`).join(', ');
  const observed = `COALESCE((SELECT array_agg(DISTINCT privilege_type::text ORDER BY privilege_type::text) FROM information_schema.role_table_grants WHERE grantee = '${grantee}' AND table_schema = 'public' AND table_name = '${table}'), ARRAY[]::text[])`;
  return {
    description: `verify ${grantee}'s explicit grants on ${table} are exactly ${grants.join(', ')}${note}`,
    sql: `SELECT (${observed}) = ARRAY[${expected}]::text[] AS result`,
  };
}

/** One `GRANT ... ON TABLE` the baseline issues, as the table types its grants came from.
 * Both halves of the operation render from this one list — the statement that issues the
 * grant (`execute`) and the postcheck that proves it took effect (`postcheck`) — so every
 * role × table pair the baseline grants is checked, and no pair is checked that it does not
 * grant. `grants` are listed alphabetically, which is the order the exact-set assertion
 * compares. */
interface GrantedTables {
  readonly description: string;
  readonly grantee: string;
  readonly tables: readonly string[];
  readonly grants: readonly string[];
  readonly note?: string;
}

const GRANTED_TABLES: readonly GrantedTables[] = [{
  description: 'grant catalog service table access',
  grantee: 'catalog_svc',
  tables: catalogTableNames,
  grants: MUTABLE_GRANTS,
}, {
  description: 'grant readonly catalog table access',
  grantee: 'readonly',
  tables: catalogReadTableNames,
  grants: SELECT_ONLY_GRANTS,
}, {
  description: 'grant users service table access',
  grantee: 'users_svc',
  tables: userTableNames,
  grants: MUTABLE_GRANTS,
}, {
  description: 'grant readonly user table access',
  grantee: 'readonly',
  tables: userTableNames,
  grants: SELECT_ONLY_GRANTS,
}, {
  description: 'grant mutable native agent table access',
  grantee: 'agent_svc',
  tables: nativeMutableTableNames,
  grants: MUTABLE_GRANTS,
}, {
  description: 'grant append-only native history access',
  grantee: 'agent_svc',
  tables: ['pi_records'],
  grants: APPEND_ONLY_GRANTS,
  note: ' (no UPDATE or DELETE grants)',
}, {
  description: 'grant agent catalog read access',
  grantee: 'agent_svc',
  tables: AGENT_CATALOG_READ_TABLES,
  grants: SELECT_ONLY_GRANTS,
}, {
  description: 'grant jobs route read access',
  grantee: 'jobs_svc',
  tables: ['saved_routes'],
  grants: SELECT_ONLY_GRANTS,
}, ...ledgerGrantEntries.map(([table, grants]) => ({
  description: `grant agent service access to ${table}`,
  grantee: 'agent_svc',
  tables: [table],
  grants,
  note: table === 'daily_usage' ? ' (no DELETE grant)' : '',
})), {
  description: 'grant jobs retention access to the conversation and anonymous meters',
  grantee: 'jobs_svc',
  tables: ['sessions', 'anon_daily_message_count'],
  grants: ['DELETE', 'SELECT'] as const,
}, {
  description: 'grant readonly turn ledger access',
  grantee: 'readonly',
  tables: ['turn_reservations'],
  grants: SELECT_ONLY_GRANTS,
}];

const grantedTableStatements = GRANTED_TABLES.map(({ description, grantee, tables, grants }) => ({
  description,
  sql: `GRANT ${grants.join(', ')} ON TABLE ${qualify(tables)} TO ${grantee}`,
}));

const grantedTablePostchecks = GRANTED_TABLES.flatMap(({ grantee, tables, grants, note = '' }) =>
  tables.map((table) => grantPostcheck(grantee, table, grants, note)));

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
  }, ...grantedTableStatements, {
    description: 'grant catalog history sequence access',
    sql: 'GRANT SELECT, USAGE ON SEQUENCE public.raw_payload_history_seq_seq TO catalog_svc',
  }],
  postcheck: [...grantedTablePostchecks, {
    description: 'verify the data-plane public-schema and sequence grants',
    sql: `SELECT has_schema_privilege('agent_svc', 'public', 'USAGE')
      AND has_schema_privilege('catalog_svc', 'public', 'USAGE')
      AND has_schema_privilege('jobs_svc', 'public', 'USAGE')
      AND has_schema_privilege('readonly', 'public', 'USAGE')
      AND has_schema_privilege('users_svc', 'public', 'USAGE')
      AND has_sequence_privilege('catalog_svc', 'public.raw_payload_history_seq_seq', 'SELECT')
      AND has_sequence_privilege('catalog_svc', 'public.raw_payload_history_seq_seq', 'USAGE') AS result`,
  }],
});
