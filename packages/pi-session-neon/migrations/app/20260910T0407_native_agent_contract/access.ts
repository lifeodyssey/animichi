import { rawSql } from '@prisma/orm-postgres/migration';

const MUTABLE_TABLES = ['pi_sessions', 'pi_scalar_values', 'pi_list_values', 'agent_admissions', 'agent_open_operations', 'agent_settlements'] as const;
const MUTABLE_GRANTS = ['DELETE', 'INSERT', 'SELECT', 'UPDATE'] as const;
const APPEND_ONLY_GRANTS = ['INSERT', 'SELECT'] as const;

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

export const AGENT_SERVICE_ACCESS = rawSql({
  id: 'agent-service-access',
  label: 'Grant agent service access to native agent tables',
  operationClass: 'additive',
  target: { id: 'postgres' },
  precheck: [{
    description: 'require the existing agent service role',
    sql: "SELECT EXISTS (SELECT FROM pg_roles WHERE rolname = 'agent_svc') AS result",
  }],
  execute: [{
    description: 'grant mutable session, value and business records',
    sql: 'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.pi_sessions, public.pi_scalar_values, public.pi_list_values, public.agent_admissions, public.agent_open_operations, public.agent_settlements TO agent_svc',
  }, {
    description: 'grant append-only native entry and usage access',
    sql: 'GRANT SELECT, INSERT ON TABLE public.pi_records TO agent_svc',
  }],
  postcheck: [
    ...MUTABLE_TABLES.map((table) => grantPostcheck(table, MUTABLE_GRANTS)),
    grantPostcheck('pi_records', APPEND_ONLY_GRANTS, ' (no UPDATE or DELETE grants)'),
  ],
});
