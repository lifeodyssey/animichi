import { afterEach, beforeAll, expect, vi } from "vitest";
import pg from "pg";
import { hookTimeoutMs, SERVICE_ROLES, SPIKE_SETUP_BUDGET } from "@animichi/test-postgres";
import { FIXED_NOW } from "../migrate.worker.helpers";
import { SERVICE_ROLE_PASSWORDS } from "../service-role-passwords";
import { provisionServiceRoles } from "../../src/service-roles";
import { settleTeardown } from "./teardown";
import { APP_MIGRATION_COUNT, nativeApp, TARGET } from "./prisma-fixture";
import { openPrismaMigrationTarget, servePrismaPostgres, type PrismaMigrationTarget } from "./prisma-postgres";
import { QUOTED_SERVICE_ROLES, roleBootTest, roleBootCluster, serviceRoleMembershipCount } from "./role-boot";

/* #1915's acceptance criteria, against real PostgreSQL: the three runtime roles gain LOGIN and
 * their bound passwords while `jobs_svc` and `readonly` stay NOLOGIN, no service role is a
 * member anywhere, a second run changes no compared `pg_authid` column, a changed bound
 * password takes effect, and — from an empty database — the step feeds the chain's precheck
 * and its exact-set grant postchecks. The unit arm
 * (`test/service-roles.test.ts`) owns the statements; this file owns the database. The
 * `roleBoot` fixture owns the cluster-level discipline: it asserts the five roles at boot
 * state before every case, holds every role write in the cluster's apply turn, and restores
 * the boot state in a `finally`. A role that arrives dirty is the reset arm's subject
 * (`service-roles.reset.integration.ts`); a cluster that starts with none is the from-nothing
 * arm's (`service-roles.from-nothing.integration.ts`). */

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
  caseTarget = await openPrismaMigrationTarget(roleBoot.adminDsn, `service_roles_case_${String(caseNumber++)}`);
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

async function roleFacts(): Promise<{ rolname: string; rolcanlogin: boolean; rolpassword: string | null }[]> {
  const { rows } = await adminSession().query<{ rolname: string; rolcanlogin: boolean; rolpassword: string | null }>(
    `SELECT pg_roles.rolname, pg_roles.rolcanlogin, pg_authid.rolpassword
       FROM pg_roles JOIN pg_authid ON pg_authid.rolname = pg_roles.rolname
      WHERE pg_roles.rolname IN (${QUOTED_SERVICE_ROLES}) ORDER BY pg_roles.rolname`);
  return rows;
}

/** A real session as the service role: true only when PostgreSQL accepted the password. */
async function loginSucceeds(dsn: string, role: string, password: string): Promise<boolean> {
  const url = new URL(dsn);
  url.username = role;
  url.password = password;
  const client = new pg.Client(url.toString());
  try {
    await client.connect();
    return true;
  } catch {
    return false;
  } finally {
    await client.end().catch(() => undefined);
  }
}

roleBootTest("gives the three runtime roles their bound logins and no service role a membership", async ({ roleBoot }) => {
  await roleBoot.hold(() => provisionServiceRoles(targetDsn(), SERVICE_ROLE_PASSWORDS));
  expect((await roleFacts()).map(({ rolname }) => rolname)).toEqual([...SERVICE_ROLES].sort());
  expect(await serviceRoleMembershipCount(adminSession())).toBe(0);
  expect(await loginSucceeds(targetDsn(), "catalog_svc", SERVICE_ROLE_PASSWORDS.catalogSvc)).toBe(true);
  expect(await loginSucceeds(targetDsn(), "users_svc", SERVICE_ROLE_PASSWORDS.usersSvc)).toBe(true);
  expect(await loginSucceeds(targetDsn(), "agent_svc", SERVICE_ROLE_PASSWORDS.agentSvc)).toBe(true);
  expect(await loginSucceeds(targetDsn(), "catalog_svc", "not-the-bound-password")).toBe(false);
  expect(await loginSucceeds(targetDsn(), "jobs_svc", SERVICE_ROLE_PASSWORDS.catalogSvc)).toBe(false);
});

roleBootTest("changes no compared pg_authid column on a second run with the same bound passwords", async ({ roleBoot }) => {
  await roleBoot.hold(() => provisionServiceRoles(targetDsn(), SERVICE_ROLE_PASSWORDS));
  const before = await roleFacts();
  await roleBoot.hold(() => provisionServiceRoles(targetDsn(), SERVICE_ROLE_PASSWORDS));
  expect(await roleFacts()).toEqual(before);
  expect(await serviceRoleMembershipCount(adminSession())).toBe(0);
});

roleBootTest("restores a login whose bound password had arrived expired", async ({ roleBoot }) => {
  await roleBoot.hold(() => adminSession().query(
    `ALTER ROLE catalog_svc WITH LOGIN PASSWORD '${SERVICE_ROLE_PASSWORDS.catalogSvc}' VALID UNTIL 'yesterday'`));
  expect(await loginSucceeds(targetDsn(), "catalog_svc", SERVICE_ROLE_PASSWORDS.catalogSvc)).toBe(false);
  await roleBoot.hold(() => provisionServiceRoles(targetDsn(), SERVICE_ROLE_PASSWORDS));
  expect(await loginSucceeds(targetDsn(), "catalog_svc", SERVICE_ROLE_PASSWORDS.catalogSvc)).toBe(true);
});

roleBootTest("applies a changed bound password and retires the old one", async ({ roleBoot }) => {
  await roleBoot.hold(() => provisionServiceRoles(targetDsn(), SERVICE_ROLE_PASSWORDS));
  const rotated = { ...SERVICE_ROLE_PASSWORDS, catalogSvc: "catalog-svc-rotated-password" };
  await roleBoot.hold(() => provisionServiceRoles(targetDsn(), rotated));
  expect(await loginSucceeds(targetDsn(), "catalog_svc", "catalog-svc-rotated-password")).toBe(true);
  expect(await loginSucceeds(targetDsn(), "catalog_svc", SERVICE_ROLE_PASSWORDS.catalogSvc)).toBe(false);
  expect(await loginSucceeds(targetDsn(), "users_svc", SERVICE_ROLE_PASSWORDS.usersSvc)).toBe(true);
});

roleBootTest("feeds the chain its precheck and exact-set grant postchecks from an empty database", async ({ roleBoot }) => {
  const app = await nativeApp(targetDsn());
  const response = await roleBoot.hold(async () => app.migrate());
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ success: true, prisma: { markerHash: TARGET, migrationsApplied: APP_MIGRATION_COUNT } });
  expect(await roleFacts()).toHaveLength(5);
  expect(await loginSucceeds(targetDsn(), "catalog_svc", SERVICE_ROLE_PASSWORDS.catalogSvc)).toBe(true);
  expect(await serviceRoleMembershipCount(adminSession())).toBe(0);
});
