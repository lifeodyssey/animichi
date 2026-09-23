import { afterEach, beforeAll, expect, vi } from "vitest";
import { hookTimeoutMs, SPIKE_SETUP_BUDGET } from "@animichi/test-postgres";
import pg from "pg";
import { FIXED_NOW } from "../migrate.worker.helpers";
import { nativeApp, TARGET, APP_MIGRATION_COUNT, BASELINE_OPERATION_COUNT } from "./prisma-fixture";
import { openPrismaMigrationTarget, servePrismaPostgres, type PrismaMigrationTarget } from "./prisma-postgres";
import { grantDatabaseCreate, migratorRole } from "./prisma-role";
import { saveEvidence } from "./neon-http-postgres";
import { roleBootTest, roleBootCluster } from "./role-boot";

/* Every /migrate this file drives runs inside the cluster's apply turn through the `roleBoot`
 * fixture: since #1915 a migrate provisions the five service roles, and the roles are
 * cluster-global (#1663). The fixture asserts their boot state before every case and restores
 * it afterwards, so a case's applies leave the five service roles exactly as it found them. */

let client: pg.Client;
let app: Awaited<ReturnType<typeof nativeApp>>;
let databaseDsn: string;
const resources: { client?: pg.Client } = {};
let caseNumber = 0;
/** Each case's target database, dropped by the case that created it: the server is shared
 * (#1663), so a leftover would collide with the next run of this lane. */
let caseTarget: PrismaMigrationTarget | undefined;

beforeAll(() => roleBootCluster(), hookTimeoutMs(SPIKE_SETUP_BUDGET));
roleBootTest.beforeEach(async ({ roleBoot }) => {
  vi.useFakeTimers({ toFake: ["Date"], now: FIXED_NOW });
  caseTarget = await openPrismaMigrationTarget(roleBoot.adminDsn, `native_delivery_case_${String(caseNumber++)}`);
  const dsn = databaseDsn = caseTarget.dsn;
  client = resources.client = new pg.Client(dsn);
  await client.connect();
  servePrismaPostgres(dsn);
  app = await nativeApp(dsn);
}, hookTimeoutMs(SPIKE_SETUP_BUDGET));
afterEach(async () => {
  await resources.client?.end();
  await caseTarget?.stop();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

roleBootTest("previews native operations through authenticated HTTP without initializing the marker", async () => {
  const response = await app.preview();
  const body: unknown = await response.json();
  expect({ status: response.status, body }).toMatchObject({ status: 200, body: { compatible: true, prisma: {
    targetHash: TARGET, markerHash: "empty", usedLiveMarker: true,
  } } });
  const chain = (body as { prisma: { migrations: { spaceId: string; from: string; to: string }[] } }).prisma.migrations;
  expect(chain).toHaveLength(APP_MIGRATION_COUNT);
  expect(chain[0]).toMatchObject({ spaceId: "app", from: "empty" });
  expect(chain.at(-1)).toMatchObject({ spaceId: "app", to: TARGET });
  expect((await client.query("SELECT to_regnamespace('prisma_contract') AS marker")).rows).toEqual([{ marker: null }]);
  expect((await client.query("SELECT to_regclass('public.pi_sessions') AS sessions")).rows).toEqual([{ sessions: null }]);
});

roleBootTest("applies the sealed native graph and replays with zero migrations while preserving data", async ({ roleBoot }) => {
  const previewBody = (await (await app.preview()).json()) as { prisma: { migrations: unknown[] } };
  const sealedCount = previewBody.prisma.migrations.length;
  const first = await roleBoot.hold(async () => app.migrate());
  expect(first.status).toBe(200);
  const appliedBody: unknown = await first.json();
  expect(appliedBody).toMatchObject({ success: true, prisma: { markerHash: TARGET, migrationsApplied: sealedCount } });
  const applied = (appliedBody as { prisma: { applied: { operationsExecuted: number }[] } }).prisma.applied;
  expect(applied).toHaveLength(sealedCount);
  expect(applied[0]).toMatchObject({ operationsExecuted: BASELINE_OPERATION_COUNT });
  await client.query("INSERT INTO pi_sessions (id, metadata) VALUES ('preserved', '{\"id\":\"preserved\",\"value\":\"null\"}')");
  const preview = await app.preview();
  expect(await preview.json()).toMatchObject({ prisma: { markerHash: TARGET, migrations: [], usedLiveMarker: true } });
  const replay = await roleBoot.hold(async () => app.migrate());
  expect(replay.status).toBe(200);
  expect(await replay.json()).toMatchObject({ success: true, prisma: { markerHash: TARGET, migrationsApplied: 0 } });
  expect((await client.query("SELECT id, metadata FROM pi_sessions")).rows).toEqual([{ id: "preserved", metadata: { id: "preserved", value: "null" } }]);
});

// `selected-migration.ts` says a prior preview is no authority. A database that leaves the
// preview's reach between the two calls has to be refused INSIDE the lock, without writing.
roleBootTest("rechecks the migration path inside apply after a previously successful preview", async ({ roleBoot }) => {
  expect((await app.preview()).status).toBe(200);
  await client.query("CREATE SCHEMA prisma_contract; CREATE TABLE prisma_contract.marker (space text PRIMARY KEY, core_hash text NOT NULL)");
  await client.query("INSERT INTO prisma_contract.marker (space, core_hash) VALUES ('app', repeat('a', 64))");
  const refused = await roleBoot.hold(async () => app.migrate());
  expect(refused.status).toBe(422);
  expect(await refused.json()).toMatchObject({ success: false });
  expect((await client.query("SELECT to_regclass('public.pi_sessions') AS sessions")).rows).toEqual([{ sessions: null }]);
});

roleBootTest("lets Prisma roll back conflicting DDL and the native marker together", async ({ roleBoot }) => {
  await client.query("CREATE TABLE public.pi_records (saved text); INSERT INTO pi_records VALUES ('preserved')");
  const response = await roleBoot.hold(async () => app.migrate());
  expect(response.status).toBe(500);
  expect(await response.json()).toMatchObject({ success: false });
  expect((await client.query("SELECT * FROM pi_records")).rows).toEqual([{ saved: "preserved" }]);
  expect((await client.query("SELECT to_regnamespace('prisma_contract') AS marker")).rows).toEqual([{ marker: null }]);
  expect((await client.query("SELECT to_regclass('public.pi_session_records') AS sessions")).rows).toEqual([{ sessions: null }]);
});

roleBootTest("requires database CREATE for the non-superuser migrator and succeeds with the inherited grant", async ({ roleBoot }) => {
  const dsn = await roleBoot.hold(() => migratorRole(client, databaseDsn));
  servePrismaPostgres(dsn);
  const roleApp = await nativeApp(dsn);
  const rolePreview = await roleApp.preview();
  expect(rolePreview.status).toBe(200);
  const roleBody: unknown = await rolePreview.json();
  const sealedCount = (roleBody as { prisma: { migrations: unknown[] } }).prisma.migrations.length;
  expect((await roleBoot.hold(async () => roleApp.migrate())).status).toBe(500);
  expect((await client.query("SELECT to_regnamespace('prisma_contract') AS marker")).rows).toEqual([{ marker: null }]);
  await roleBoot.hold(() => grantDatabaseCreate(client, dsn));
  const result = await roleBoot.hold(async () => roleApp.migrate());
  const body: unknown = await result.json();
  expect({ status: result.status, body }).toMatchObject({ status: 200, body: {
    success: true, prisma: { markerHash: TARGET, migrationsApplied: sealedCount },
  } });
  expect((await client.query("SELECT rolsuper FROM pg_roles WHERE rolname = 'migrator'")).rows).toEqual([{ rolsuper: false }]);
  expect((await client.query("SELECT pg_get_userbyid(nspowner) AS owner FROM pg_namespace WHERE nspname='prisma_contract'")).rows).toEqual([{ owner: "migrator" }]);
  await saveEvidence("native-migrator-role", { superuser: false, withoutDatabaseCreate: { preview: 200, apply: 500 }, withDatabaseCreate: { status: result.status, body }, markerSchemaOwner: "migrator" });
});

// #1625: the flip meets a staging database still on the retired Atlas chain, whose objects the
// baseline would CREATE onto (42710). CD rebuilds that state first; if it did not, both routes
// refuse it by name before any DDL rather than fail inside the apply.
roleBootTest("refuses a database still carrying the Atlas ledger by name before any DDL", async ({ roleBoot }) => {
  await client.query("CREATE TABLE public.atlas_schema_revisions (version text PRIMARY KEY); INSERT INTO atlas_schema_revisions VALUES ('20260826000003')");
  const preview = await app.preview();
  expect({ status: preview.status, body: await preview.json() }).toMatchObject({
    status: 422, body: { compatible: false, error: "atlas_leftovers_present" } });
  const refused = await roleBoot.hold(async () => app.migrate());
  expect({ status: refused.status, body: await refused.json() }).toMatchObject({
    status: 422, body: { success: false, error: "atlas_leftovers_present" } });
  expect((await client.query("SELECT to_regnamespace('prisma_contract') AS marker")).rows).toEqual([{ marker: null }]);
  expect((await client.query("SELECT to_regclass('public.pi_sessions') AS sessions")).rows).toEqual([{ sessions: null }]);
});
