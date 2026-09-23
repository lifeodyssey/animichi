import { afterEach, beforeAll, expect, vi } from "vitest";
import pg from "pg";
import { hookTimeoutMs, SPIKE_SETUP_BUDGET } from "@animichi/test-postgres";
import { FIXED_NOW } from "../migrate.worker.helpers";
import { SERVICE_ROLE_PASSWORDS } from "../service-role-passwords";
import { provisionServiceRoles } from "../../src/service-roles";
import { openPrismaMigrationTarget, servePrismaPostgres, type PrismaMigrationTarget } from "./prisma-postgres";
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
  await admin?.end();
  await caseTarget?.stop();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** Remove the probe role and every edge touching it, present or not: the membership case's
 * setup and its `finally` both run this, so no run of the file leaves the role behind. The
 * probe is this arm's own creation, so its cleanup is this arm's, not the fixture's. */
async function dropMembershipProbe(client: pg.Client): Promise<void> {
  await client.query(`DO $plain$ DECLARE edge record; BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'membership_probe') THEN RETURN; END IF;
    FOR edge IN SELECT g.rolname AS granted, m.rolname AS member FROM pg_auth_members a
      JOIN pg_roles g ON g.oid = a.roleid JOIN pg_roles m ON m.oid = a.member
     WHERE g.rolname = 'membership_probe' OR m.rolname = 'membership_probe'
    LOOP
      EXECUTE format('REVOKE %I FROM %I', edge.granted, edge.member);
    END LOOP;
    EXECUTE 'DROP ROLE membership_probe';
  END $plain$`);
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
    await adminSession().query("CREATE ROLE membership_probe NOLOGIN");
    await adminSession().query("GRANT membership_probe TO catalog_svc");
  });
  try {
    await roleBoot.hold(() => provisionServiceRoles(targetDsn(), SERVICE_ROLE_PASSWORDS));
    expect(await serviceRoleMembershipCount(adminSession())).toBe(0);
  } finally {
    await roleBoot.hold(async () => { await dropMembershipProbe(adminSession()); });
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
