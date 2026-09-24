import { afterAll, beforeAll, expect, it } from "vitest";
import pg from "pg";
import {
  ChainApplyTurn,
  hookTimeoutMs,
  SPIKE_SETUP_BUDGET,
  startOwnedPostgresCluster,
  type OwnedPostgresCluster,
} from "@animichi/test-postgres";
import { APP_MIGRATION_COUNT, nativeApp, TARGET } from "./prisma-fixture";
import { openPrismaMigrationTarget, servePrismaPostgres, type PrismaMigrationTarget } from "./prisma-postgres";
import { settleTeardown } from "./teardown";
import { QUOTED_SERVICE_ROLES } from "./role-boot";

/* AC1/AC2's from-nothing proof, on a container of its own. The shared cluster's boot creates
 * the five service roles itself (#1783), so "starting with no service roles" can never be
 * observed there. This arm boots a container shared with nobody and provisions
 * no role: every service role that exists once the step has run is one the step made, and the chain's
 * precheck — the production reader of exactly that fact — passes on them. The step and the
 * chain run inside the container's own apply turn, as they do against the shared cluster. */

let turn: ChainApplyTurn | undefined;
let target: PrismaMigrationTarget | undefined;
let admin: pg.Client | undefined;
let cluster: OwnedPostgresCluster | undefined;

/** The arm's resources, owned by the hooks: cases own the use. */
function applyTurn(): ChainApplyTurn {
  const held = turn;
  if (held === undefined) throw new Error("the arm's apply turn is not open");
  return held;
}

function adminSession(): pg.Client {
  const client = admin;
  if (client === undefined) throw new Error("the arm's admin session is not open");
  return client;
}

function targetDsn(): string {
  const dsn = target?.dsn;
  if (dsn === undefined) throw new Error("the arm's target database is not open");
  return dsn;
}

beforeAll(async () => {
  cluster = await startOwnedPostgresCluster({ budget: SPIKE_SETUP_BUDGET });
  turn = new ChainApplyTurn(cluster.adminDsn);
  target = await openPrismaMigrationTarget(cluster.adminDsn, "service_roles_from_nothing");
  admin = new pg.Client(cluster.adminDsn);
  await admin.connect();
  servePrismaPostgres(targetDsn());
}, hookTimeoutMs(SPIKE_SETUP_BUDGET));

afterAll(async () => {
  await settleTeardown([async () => admin?.end(), async () => target?.stop(), async () => cluster?.stop()]);
});

it("creates all five service roles from nothing, and the chain's precheck passes on them", async () => {
  const app = await nativeApp(targetDsn());
  const response = await applyTurn().hold(async () => app.migrate());
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ success: true, prisma: { markerHash: TARGET, migrationsApplied: APP_MIGRATION_COUNT } });
  const logins = await adminSession().query<{ rolname: string; rolcanlogin: boolean }>(
    `SELECT rolname, rolcanlogin FROM pg_roles WHERE rolname IN (${QUOTED_SERVICE_ROLES}) ORDER BY rolname`);
  expect(logins.rows).toEqual([
    { rolname: "agent_svc", rolcanlogin: true },
    { rolname: "catalog_svc", rolcanlogin: true },
    { rolname: "jobs_svc", rolcanlogin: false },
    { rolname: "readonly", rolcanlogin: false },
    { rolname: "users_svc", rolcanlogin: true },
  ]);
  const memberships = await adminSession().query<{ count: string }>(
    `SELECT count(*)::text AS count FROM pg_auth_members a
       JOIN pg_roles m ON m.oid = a.member WHERE m.rolname IN (${QUOTED_SERVICE_ROLES})`);
  expect(memberships.rows).toEqual([{ count: "0" }]);
});
