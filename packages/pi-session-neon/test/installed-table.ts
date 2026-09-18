// What PostgreSQL reports about one installed table. The agent tier's ledger and meters are
// raw-SQL objects with no contract declaration to read, so their suites ask the catalog.
import type pg from "pg";

export async function columnNames(pool: pg.Pool, table: string): Promise<string[]> {
  const rows = await pool.query<{ column_name: string }>(
    "SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 ORDER BY column_name",
    [table],
  );
  return rows.rows.map((row) => row.column_name);
}

export async function explicitAgentGrants(pool: pg.Pool, table: string): Promise<string[]> {
  const rows = await pool.query<{ privilege_type: string }>(
    "SELECT DISTINCT privilege_type FROM information_schema.role_table_grants WHERE grantee = 'agent_svc' AND table_schema = 'public' AND table_name = $1 ORDER BY privilege_type",
    [table],
  );
  return rows.rows.map((row) => row.privilege_type);
}
