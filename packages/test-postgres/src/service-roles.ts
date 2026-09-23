/** The five service roles every disposable data plane needs: their creation, and
 * the assertion that names whichever one is absent.
 *
 * The roles are CLUSTER-global, and their DDL stays outside the migration chain:
 * since #1915 the migrator Worker creates them by SQL on `/migrate` (spec
 * §4.8.5, as amended). A disposable container has no migrator Worker, so this
 * package owns them for the cluster it boots — the same ownership split as the
 * container itself.
 *
 * They are not optional decoration: the chain's grant matrix prechecks all five
 * (`data-plane-access`), and the role-privilege suites assert them by name. So
 * creation and the assertion that reads it are separate steps, called in that
 * order by `test-postgres.ts`: a missing role then fails as a missing role,
 * named, instead of as whatever the chain reaches first.
 *
 * Creation is check-then-create, which is NOT atomic: two callers that read an
 * empty `pg_roles` together both create, and the loser dies on
 * `pg_authid_rolname_index` (#1663). The cluster turn in `chain-apply-turn.ts`
 * is what serialises them, across processes and worktrees.
 */
import pg from "pg";

/** One session against the cluster `dsn` reaches, run `work`, always end it. */
async function withClusterSession<Result>(dsn: string, work: (client: pg.Client) => Promise<Result>): Promise<Result> {
  const client = new pg.Client(dsn);
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

/** The roles the data plane's grant matrix names, in one place. */
export const SERVICE_ROLES = ["agent_svc", "catalog_svc", "jobs_svc", "readonly", "users_svc"] as const;

/** `ARRAY['a', 'b']::text[]` for the creation block.
 *
 * The block cannot take a bind parameter — a `DO` body is a literal, not a
 * prepared statement — so the names are written into it. They come from the
 * constant above and nowhere else, so this renders the one list rather than
 * keeping a second copy of it. */
function roleArrayLiteral(roles: readonly string[]): string {
  return `ARRAY[${roles.map((role) => `'${role}'`).join(", ")}]::text[]`;
}

/** The same shape the chain's original `20260826000001_roles.sql` had: one
 * NOLOGIN role per name, created only when absent. */
function createRolesStatement(roles: readonly string[]): string {
  return `DO $$
DECLARE
  role_name text;
BEGIN
  FOREACH role_name IN ARRAY ${roleArrayLiteral(roles)}
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format('CREATE ROLE %I NOLOGIN', role_name);
    END IF;
  END LOOP;
END $$`;
}

/** The chain's grant matrix is the reader that made these rows load-bearing: it
 * prechecks all five in one statement, and PostgreSQL reports only that the
 * statement was false. */
const MISSING_ROLES = `SELECT candidate FROM unnest($1::text[]) AS candidates(candidate)
  WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = candidate)
  ORDER BY candidate`;

/** Create every role in `roles` the cluster does not already have. */
export async function createServiceRoles(dsn: string, roles: readonly string[] = SERVICE_ROLES): Promise<void> {
  await withClusterSession(dsn, (client) => client.query(createRolesStatement(roles)).then(() => undefined));
}

/** Throw naming each role that is absent, so a missing role reads as one. */
export async function assertServiceRoles(dsn: string, roles: readonly string[] = SERVICE_ROLES): Promise<void> {
  const missing = await withClusterSession(dsn, async (client) => {
    const { rows } = await client.query<{ candidate: string }>(MISSING_ROLES, [roles]);
    return rows.map((row) => row.candidate);
  });
  if (missing.length > 0) {
    throw new Error(`missing PostgreSQL service roles: ${missing.join(", ")}`);
  }
}
