import { neon } from "@neondatabase/serverless";
import type { Env } from "./create-app";

/**
 * #1915 — the five data-plane service roles are provisioned by SQL, never by the Neon API.
 * Neon grants `neon_superuser` to every role its Console, CLI or API creates, and only Neon's
 * own `cloud_admin` can revoke that membership, so the Pulumi `neon.Role`s made a leaked
 * runtime DSN read and write every table. A role created by SQL receives no membership, which
 * is why the migrator — the one Worker that already holds a database credential — runs this
 * step inside the apply gate on every `/migrate`, before the chain, and idempotently:
 * roles are created check-then-create, attributes are reset to the grant matrix's assumed
 * shape, foreign memberships are revoked, and a runtime password is rewritten only when a
 * probe session proves the bound password no longer lets the role in — so a second run
 * issues no ALTER and leaves `pg_authid` byte-for-byte as it found it. Role DDL still lives
 * outside the chain (`workers/edge/test/migrator-ac3-proof.test.ts`); what changed with
 * #1915 is its owner.
 */

/** The runtime DSN holders whose passwords Pulumi binds to this Worker alone. */
export interface RuntimeRolePasswords {
  readonly catalogSvc: string;
  readonly usersSvc: string;
  readonly agentSvc: string;
}

const RUNTIME_ROLES = ["agent_svc", "catalog_svc", "users_svc"] as const;
const NOLOGIN_ROLES = ["jobs_svc", "readonly"] as const;
const SERVICE_ROLES = [...RUNTIME_ROLES, ...NOLOGIN_ROLES] as const;

/** Role name -> its `RuntimeRolePasswords` key, so the SQL names one list, not a copy. */
const PASSWORD_ROLES = {
  agent_svc: "agentSvc",
  catalog_svc: "catalogSvc",
  users_svc: "usersSvc",
} as const satisfies Record<(typeof RUNTIME_ROLES)[number], keyof RuntimeRolePasswords>;

const ROLE_NAME_LIST = SERVICE_ROLES.map((role) => `'${role}'`).join(", ");

/** Created only when absent, so an existing role keeps the password it already holds. */
const ENSURE_ROLES_EXIST = `DO $$
DECLARE
  role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY[${ROLE_NAME_LIST}]::text[]
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format('CREATE ROLE %I NOLOGIN', role_name);
    END IF;
  END LOOP;
END $$`;

/** The staging defect this card removes was a membership, not an attribute: the API-created
 * roles sat in `neon_superuser`. Whatever any other hand granted to the five is revoked by
 * name on every run, so the guarantee does not depend on how the roles arrived. */
const REVOKE_MEMBERSHIPS = `DO $$
DECLARE
  edge record;
BEGIN
  FOR edge IN
    SELECT granted.rolname AS granted_role, member.rolname AS member_role
      FROM pg_auth_members membership
      JOIN pg_roles granted ON granted.oid = membership.roleid
      JOIN pg_roles member ON member.oid = membership.member
     WHERE member.rolname IN (${ROLE_NAME_LIST})
  LOOP
    EXECUTE format('REVOKE %I FROM %I', edge.granted_role, edge.member_role);
  END LOOP;
END $$`;

/**
 * Reset the five roles' attribute matrix, but state only what differs: PostgreSQL 18 lets a
 * role with ADMIN OPTION change an attribute it does not hold only when the change is real —
 * restating `NOCREATEDB` on a role that already has it is a superuser-only statement. A role
 * that is genuinely a superuser must be demoted, and on a platform that refuses the demotion
 * this block fails, which is exactly the fail-closed outcome a superuser service role earns.
 */
const RESET_ROLE_ATTRIBUTES = `DO $plain$
DECLARE
  role_name text;
  desired_login boolean;
  current_state record;
  clauses text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY[${ROLE_NAME_LIST}]::text[]
  LOOP
    desired_login := role_name IN (${RUNTIME_ROLES.map((role) => `'${role}'`).join(", ")});
    SELECT rolsuper, rolcreatedb, rolcreaterole, rolbypassrls, rolreplication, rolcanlogin
      INTO current_state FROM pg_roles WHERE rolname = role_name;
    clauses := '';
    IF current_state.rolsuper THEN clauses := clauses || ' NOSUPERUSER'::text; END IF;
    IF current_state.rolcreatedb THEN clauses := clauses || ' NOCREATEDB'::text; END IF;
    IF current_state.rolcreaterole THEN clauses := clauses || ' NOCREATEROLE'::text; END IF;
    IF current_state.rolbypassrls THEN clauses := clauses || ' NOBYPASSRLS'::text; END IF;
    IF current_state.rolreplication THEN clauses := clauses || ' NOREPLICATION'::text; END IF;
    IF current_state.rolcanlogin != desired_login THEN
      clauses := clauses || (CASE WHEN desired_login THEN ' LOGIN'::text ELSE ' NOLOGIN'::text END);
    END IF;
    IF clauses <> '' THEN
      EXECUTE format('ALTER ROLE %I WITH%s', role_name, clauses);
    END IF;
  END LOOP;
END
$plain$`;

/** `ALTER ROLE … PASSWORD` takes an SQL literal, not a bind parameter, so the value is
 * doubled-quote escaped; RandomPassword emits no quotes, this is the belt for those braces. */
const sqlLiteral = (value: string): string => value.replaceAll("'", "''");

const setPasswordStatement = (role: string, password: string): string =>
  `ALTER ROLE ${role} PASSWORD '${sqlLiteral(password)}'`;

/**
 * True when `role` can open a session with `password` right now — the one fact the DSN
 * secrets in the store depend on. A probe is three round trips per `/migrate`, and it is the
 * only check that survives both a drifted password and a drifted verifier: no catalog read
 * (`pg_authid` is not for this role to read) and no marker stored beside the role.
 */
async function authenticates(baseDsn: string, role: string, password: string): Promise<boolean> {
  const url = new URL(baseDsn);
  url.username = role;
  url.password = password;
  const sql = neon(url.toString());
  try {
    await sql.query("SELECT 1");
    return true;
  } catch {
    return false;
  }
}

/**
 * The password statements the bound passwords currently need — one per runtime role the
 * probe could not log in. A role that authenticates is left untouched; a transport failure
 * on the probe shows up as one extra password restatement or, if it persists, as this
 * statement's own error.
 */
async function stalePasswordStatements(baseDsn: string, passwords: RuntimeRolePasswords): Promise<string[]> {
  const stale = await Promise.all(Object.entries(PASSWORD_ROLES).map(async ([role, key]) =>
    await authenticates(baseDsn, role, passwords[key]) ? [] : [setPasswordStatement(role, passwords[key])]));
  return stale.flat();
}

/**
 * One transaction: a statement that fails anywhere leaves the roles exactly as it found
 * them, and the chain after this step either runs against the provisioned shape or not at all.
 */
export async function provisionServiceRoles(dsn: string, passwords: RuntimeRolePasswords): Promise<void> {
  const sql = neon(dsn);
  const statements = [
    ENSURE_ROLES_EXIST, REVOKE_MEMBERSHIPS, RESET_ROLE_ATTRIBUTES,
    ...await stalePasswordStatements(dsn, passwords),
  ];
  await sql.transaction<false, false>(statements.map((statement) => sql.query(statement)));
}

async function resolveSecret(value: string | SecretsStoreSecret | undefined): Promise<string | undefined> {
  if (value == null) return undefined;
  return typeof value === "string" ? value : await value.get();
}

/** All three passwords, or none: a missing binding refuses the apply instead of provisioning
 * roles that could not authenticate the DSN secrets already sitting in the store. */
export async function resolveRuntimePasswords(env: Env): Promise<RuntimeRolePasswords | undefined> {
  const [catalogSvc, usersSvc, agentSvc] = await Promise.all([
    resolveSecret(env.CATALOG_SVC_PASSWORD),
    resolveSecret(env.USERS_SVC_PASSWORD),
    resolveSecret(env.AGENT_SVC_PASSWORD),
  ]);
  if (catalogSvc === undefined || usersSvc === undefined || agentSvc === undefined) return undefined;
  return { catalogSvc, usersSvc, agentSvc };
}
