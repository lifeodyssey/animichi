import { afterEach, beforeAll, expect, vi } from "vitest";
import pg from "pg";
import { hookTimeoutMs, SPIKE_SETUP_BUDGET } from "@animichi/test-postgres";
import { FIXED_NOW } from "../migrate.worker.helpers";
import { SERVICE_ROLE_PASSWORDS } from "../service-role-passwords";
import { provisionServiceRoles } from "../../src/service-roles";
import { openPrismaMigrationTarget, servePrismaPostgres, type PrismaMigrationTarget } from "./prisma-postgres";
import { migratorDsn, migratorRole } from "./prisma-role";
import { settleTeardown } from "./teardown";
import {
  QUOTED_SERVICE_ROLES, roleBootTest, roleBootCluster, serviceRoleMembershipCount,
} from "./role-boot";

/* The reset half of #1915's acceptance, against real PostgreSQL: the step not only creates
 * clean roles, it strips what arrives from outside — the staging defect was a membership
 * (`neon_superuser` on API-created roles), so a foreign membership must be revoked and a role
 * carrying extra attributes must be brought back to the grant matrix's assumed shape. Each
 * case pre-pollutes the cluster roles it needs inside the cluster's turn, runs the step, and
 * asserts the polluted state did not survive. The `roleBoot` fixture owns the cluster-level
 * discipline: it asserts the five roles at boot state before every case, holds every role
 * write, and restores the boot state in a `finally` — including what a case pre-polluted,
 * so no run of the file leaves anything behind. */

const NO_PRIVILEGES = Object.fromEntries(["agent_svc", "catalog_svc", "jobs_svc", "readonly", "users_svc"].flatMap((role) =>
  ["rolsuper", "rolcreaterole", "rolcreatedb", "rolbypassrls"].map((flag) => [`${role}.${flag}`, false])));

/** The arm's own probe role and the grantor a foreign membership is recorded against. */
const PROBE = "membership_probe";
const PROBE_GRANTOR = "membership_probe_grantor";

let caseTarget: PrismaMigrationTarget | undefined;
let caseNumber = 0;
let admin: pg.Client | undefined;

/** The case's session and target: hooks own the lifetime, cases own the use. */
function adminSession(): pg.Client {
  const client = admin;
  if (client === undefined) throw new Error("the case's admin session is not open");
  return client;
}

function targetDsn(): string {
  const dsn = caseTarget?.dsn;
  if (dsn === undefined) throw new Error("the case's target database is not open");
  return dsn;
}

beforeAll(() => roleBootCluster(), hookTimeoutMs(SPIKE_SETUP_BUDGET));
roleBootTest.beforeEach(async ({ roleBoot }) => {
  vi.useFakeTimers({ toFake: ["Date"], now: FIXED_NOW });
  caseTarget = await openPrismaMigrationTarget(roleBoot.adminDsn, `service_roles_reset_case_${String(caseNumber++)}`);
  admin = new pg.Client(roleBoot.adminDsn);
  await admin.connect();
  servePrismaPostgres(caseTarget.dsn);
}, hookTimeoutMs(SPIKE_SETUP_BUDGET));
afterEach(async () => {
  try {
    await settleTeardown([async () => admin?.end(), async () => caseTarget?.stop()]);
  } finally {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  }
});

/** Remove the probe role and every edge touching it, present or not: each membership case's
 * `finally` runs this, so no run of the file leaves the role behind. The probe is this arm's
 * own creation, so its cleanup is this arm's, not the fixture's. */
async function dropMembershipProbe(client: pg.Client): Promise<void> {
  await client.query(`DO $plain$ DECLARE edge record; BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${PROBE}') THEN RETURN; END IF;
    FOR edge IN SELECT g.rolname AS granted, m.rolname AS member FROM pg_auth_members a
      JOIN pg_roles g ON g.oid = a.roleid JOIN pg_roles m ON m.oid = a.member
     WHERE g.rolname = '${PROBE}' OR m.rolname = '${PROBE}'
    LOOP
      EXECUTE format('REVOKE %I FROM %I', edge.granted, edge.member);
    END LOOP;
    EXECUTE 'DROP ROLE ${PROBE}';
  END $plain$`);
}

/** A membership whose recorded grantor is not the role the step's SQL runs as. PostgreSQL 16+
 * removes on REVOKE only the edges the revoking role granted, so this edge survives the step's
 * loop — the fact its fail-closed check reads. `GRANTED BY` records the foreign grantor without
 * a second session, and the grantor's ADMIN OPTION is what lets cleanup reach the edge after
 * the check has refused provisioning. */
async function grantForeignMembership(client: pg.Client): Promise<void> {
  await client.query(`CREATE ROLE ${PROBE} NOLOGIN; CREATE ROLE ${PROBE_GRANTOR} NOLOGIN`);
  await client.query(`GRANT ${PROBE} TO ${PROBE_GRANTOR} WITH ADMIN OPTION`);
  await client.query(`GRANT ${PROBE} TO catalog_svc GRANTED BY ${PROBE_GRANTOR}`);
}

async function dropForeignMembership(client: pg.Client): Promise<void> {
  await client.query(`REVOKE ADMIN OPTION FOR ${PROBE} FROM ${PROBE_GRANTOR} CASCADE`);
  await client.query(`DROP ROLE IF EXISTS ${PROBE_GRANTOR}`);
  await dropMembershipProbe(client);
}

async function roleFacts(): Promise<{ rolname: string; rolcanlogin: boolean }[]> {
  const { rows } = await adminSession().query<{ rolname: string; rolcanlogin: boolean }>(
    `SELECT rolname, rolcanlogin FROM pg_roles WHERE rolname IN (${QUOTED_SERVICE_ROLES}) ORDER BY rolname`);
  return rows;
}

async function privilegeFlags(): Promise<Record<string, boolean>> {
  const { rows } = await adminSession().query<{ rolname: string; rolsuper: boolean; rolcreaterole: boolean; rolcreatedb: boolean; rolbypassrls: boolean }>(
    `SELECT rolname, rolsuper, rolcreaterole, rolcreatedb, rolbypassrls
       FROM pg_roles WHERE rolname IN (${QUOTED_SERVICE_ROLES}) ORDER BY rolname`);
  return Object.fromEntries(rows.flatMap(({ rolname, ...flags }) =>
    Object.entries(flags).map(([flag, value]) => [`${rolname}.${flag}`, value])));
}

roleBootTest("revokes a membership that arrives from outside the step", async ({ roleBoot }) => {
  await roleBoot.hold(async () => {
    await dropMembershipProbe(adminSession());
    await adminSession().query(`CREATE ROLE ${PROBE} NOLOGIN`);
    await adminSession().query(`GRANT ${PROBE} TO catalog_svc`);
  });
  try {
    await roleBoot.hold(() => provisionServiceRoles(targetDsn(), SERVICE_ROLE_PASSWORDS));
    expect(await serviceRoleMembershipCount(adminSession())).toBe(0);
  } finally {
    await roleBoot.hold(async () => { await dropMembershipProbe(adminSession()); });
  }
});

roleBootTest("refuses to provision while a membership its authority did not grant remains", async ({ roleBoot }) => {
  await roleBoot.hold(() => grantForeignMembership(adminSession()));
  try {
    const refused = await roleBoot.hold(() => provisionServiceRoles(targetDsn(), SERVICE_ROLE_PASSWORDS)
      .then(() => undefined, (error: unknown) => error));
    const message = String(refused);
    expect(message).toContain("catalog_svc");
    expect(message).toContain(PROBE);
    expect(message).toContain(PROBE_GRANTOR);
    expect(message).toContain("cannot revoke");
    expect(await serviceRoleMembershipCount(adminSession())).toBe(1);
  } finally {
    await roleBoot.hold(() => dropForeignMembership(adminSession()));
  }
});

roleBootTest("revokes a membership the migrator's own authority granted", async ({ roleBoot }) => {
  await roleBoot.hold(async () => {
    await migratorRole(adminSession(), targetDsn());
    await adminSession().query(`CREATE ROLE ${PROBE} NOLOGIN`);
    await adminSession().query(`GRANT ${PROBE} TO neon_superuser WITH ADMIN OPTION`);
    await adminSession().query(`GRANT ${PROBE} TO catalog_svc GRANTED BY neon_superuser`);
  });
  try {
    await roleBoot.hold(() => provisionServiceRoles(migratorDsn(targetDsn()), SERVICE_ROLE_PASSWORDS));
    expect(await serviceRoleMembershipCount(adminSession())).toBe(0);
  } finally {
    await roleBoot.hold(async () => {
      await adminSession().query(`REVOKE ADMIN OPTION FOR ${PROBE} FROM neon_superuser CASCADE`);
      await dropMembershipProbe(adminSession());
    });
  }
});

roleBootTest("restores the attribute matrix of a role that arrives wrong", async ({ roleBoot }) => {
  await roleBoot.hold(async () => {
    await adminSession().query("ALTER ROLE jobs_svc WITH LOGIN; ALTER ROLE catalog_svc WITH CREATEDB");
  });
  await roleBoot.hold(() => provisionServiceRoles(targetDsn(), SERVICE_ROLE_PASSWORDS));
  expect(await privilegeFlags()).toEqual(NO_PRIVILEGES);
  expect(Object.fromEntries((await roleFacts()).map(({ rolname, rolcanlogin }) => [rolname, rolcanlogin])))
    .toEqual({ agent_svc: true, catalog_svc: true, jobs_svc: false, readonly: false, users_svc: true });
});
