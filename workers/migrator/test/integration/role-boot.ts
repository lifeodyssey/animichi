import pg from "pg";
import { expect, test as base } from "vitest";
import {
  ChainApplyTurn,
  SERVICE_ROLES,
  SPIKE_SETUP_BUDGET,
  startTestPostgresCluster,
  type TestPostgresCluster,
} from "@animichi/test-postgres";

/* The shared cluster's role boot (#1663, #1915): every suite here writes roles, through /migrate
 * or the provisioning step itself. The roles are cluster-global, so the fixture hands each case
 * the one turn role writes may run in, and keeps the five service roles at the boot state
 * `startTestPostgresCluster` leaves them in: it asserts that state before every case — so a
 * leak from any earlier case or file goes red here, inside the migrator suite — and restores
 * it in a `finally`, so no run of a file leaves anything behind. What the step does to the
 * roles is the service-roles arms' subject; what any other hand did is this fixture's to undo. */

/** The five roles, quoted, for the suite queries that name them. */
export const QUOTED_SERVICE_ROLES = SERVICE_ROLES.map((role) => `'${role}'`).join(", ");

/** The boot matrix: NOLOGIN, no attribute, no password, and none of the five a member of
 * any role — what `createServiceRoles` leaves and every suite must find and leave. */
const BOOT_STATE = SERVICE_ROLES.map((role) => ({
  rolname: role, rolcanlogin: false, rolsuper: false,
  rolcreaterole: false, rolcreatedb: false, rolbypassrls: false, no_password: true,
}));

const ROLE_FACTS = `SELECT r.rolname, r.rolcanlogin, r.rolsuper, r.rolcreaterole,
       r.rolcreatedb, r.rolbypassrls, a.rolpassword IS NULL AS no_password
  FROM pg_roles r JOIN pg_authid a ON a.rolname = r.rolname
 WHERE r.rolname IN (${QUOTED_SERVICE_ROLES}) ORDER BY r.rolname`;

/** How many roles the five are members of: boot has none, and the step revokes what arrives. */
export async function serviceRoleMembershipCount(client: pg.Client): Promise<number> {
  const { rows } = await client.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM pg_auth_members a
       JOIN pg_roles m ON m.oid = a.member WHERE m.rolname IN (${QUOTED_SERVICE_ROLES})`);
  return Number(rows[0]?.count);
}

/** What the fixture provides a case: the admin DSN its databases open on, and the one turn
 * its role writes may run in. */
export interface RoleBoot {
  readonly adminDsn: string;
  hold<Result>(write: () => Promise<Result>): Promise<Result>;
}

let cluster: Promise<TestPostgresCluster> | undefined;

/** The cluster this module's fixture keeps, for a suite hook that must open a database before
 * any case runs; the container is reused (#1663), so each file's re-acquisition only
 * re-provisions the roles. */
export function roleBootCluster(): Promise<TestPostgresCluster> {
  cluster ??= startTestPostgresCluster({ budget: SPIKE_SETUP_BUDGET });
  return cluster;
}

/** The entry guard: anything but the boot state is an earlier case's leak. */
async function assertBootState(adminDsn: string): Promise<void> {
  const client = new pg.Client(adminDsn);
  await client.connect();
  try {
    const facts = await client.query<{
      rolname: string; rolcanlogin: boolean; rolsuper: boolean; rolcreaterole: boolean;
      rolcreatedb: boolean; rolbypassrls: boolean; no_password: boolean;
    }>(ROLE_FACTS);
    expect(facts.rows).toEqual(BOOT_STATE);
    expect(await serviceRoleMembershipCount(client)).toBe(0);
  } finally {
    await client.end();
  }
}

/** The boot state again: memberships revoked, attributes and the login bit back to the boot
 * matrix, passwords dropped, expiry normalised to "never" (PostgreSQL's `VALID UNTIL` takes a
 * timestamp, not NULL, so a boot row and a restored row both read as no expiry). A write, so
 * it runs inside the turn. */
async function restoreBootState(adminDsn: string): Promise<void> {
  const client = new pg.Client(adminDsn);
  await client.connect();
  try {
    await client.query(`DO $plain$ DECLARE edge record; role_name text; BEGIN
      FOR edge IN SELECT granted.rolname AS granted_role, member.rolname AS member_role
                    FROM pg_auth_members membership
                    JOIN pg_roles granted ON granted.oid = membership.roleid
                    JOIN pg_roles member ON member.oid = membership.member
                   WHERE member.rolname IN (${QUOTED_SERVICE_ROLES})
      LOOP EXECUTE format('REVOKE %I FROM %I', edge.granted_role, edge.member_role); END LOOP;
      FOREACH role_name IN ARRAY ARRAY[${QUOTED_SERVICE_ROLES}]::text[] LOOP
        EXECUTE format('ALTER ROLE %I WITH NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION PASSWORD NULL VALID UNTIL ''infinity''', role_name);
      END LOOP;
    END $plain$`);
  } finally {
    await client.end();
  }
}

export const roleBootTest = base.extend<{ roleBoot: RoleBoot }>({
  // A fixture states its dependencies in its signature; `task` is vitest's own built-in, and
  // naming it is how this one declares that it depends on nothing else.
  roleBoot: async ({ task: _task }, use) => {
    const booted = await roleBootCluster();
    const turn = new ChainApplyTurn(booted.adminDsn);
    await turn.hold(() => assertBootState(booted.adminDsn));
    try {
      await use({ adminDsn: booted.adminDsn, hold: (write) => turn.hold(write) });
    } finally {
      await turn.hold(() => restoreBootState(booted.adminDsn));
    }
  },
});
