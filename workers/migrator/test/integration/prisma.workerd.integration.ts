import { afterAll, beforeAll, expect } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import pg from "pg";
import { hookTimeoutMs, SPIKE_SETUP_BUDGET } from "@animichi/test-postgres";
import { issuedToken } from "../migrate.worker.helpers";
import { requestMetadata, TARGET } from "./prisma-fixture";
import { buildPrismaWorker } from "./prisma-bundle";
import { startPrismaWorker } from "./prisma-workerd";
import { openPrismaMigrationTarget, type PrismaMigrationTarget } from "./prisma-postgres";
import { grantDatabaseCreate, migratorDsn, migratorRole } from "./prisma-role";
import { saveEvidence } from "./neon-http-postgres";
import { roleBootTest, roleBootCluster } from "./role-boot";
import { settleTeardown } from "./teardown";

/* The deployed bundle against the real data plane (#1868, #1915). Every /migrate the worker
 * applies provisions the five service roles, and the roles are cluster-global (#1663), so
 * each case's applies run inside the cluster's apply turn through the `roleBoot` fixture —
 * which asserts the roles' boot state before every case and restores it afterwards. The
 * migrator identity itself is per-case too: `migratorRole` writes roles, so it runs inside
 * the turn in `beforeEach`, keeping every role write of the file in the fixture's discipline. */

/** Cloudflare's documented `blockConcurrencyWhile` cap, which this runtime enforces locally. */
const CALLBACK_CAP_MS = 30_000;
const PAST_THE_CALLBACK_CAP_MS = 31_000;

let runtime: Awaited<ReturnType<typeof startPrismaWorker>>;
let token: string;
let target: PrismaMigrationTarget | undefined;
let client: pg.Client | undefined;
const resources: { runtime?: typeof runtime; directory?: string } = {};

/** The worker's data plane, opened by `beforeAll`: hooks own the lifetime, cases own the use. */
function dataPlane(): { client: pg.Client; dsn: string } {
  if (client === undefined || target === undefined) throw new Error("the worker's data plane is not open");
  return { client, dsn: target.dsn };
}

beforeAll(async () => {
  const directory = resources.directory = await mkdtemp(join(tmpdir(), "native-migrator-worker-"));
  await buildPrismaWorker(directory);
  const cluster = await roleBootCluster();
  target = await openPrismaMigrationTarget(cluster.adminDsn, "native_delivery_worker_contract");
  client = new pg.Client(target.dsn);
  await client.connect();
  const signed = await issuedToken();
  token = signed.token;
  const started = performance.now();
  runtime = resources.runtime = await startPrismaWorker(directory, migratorDsn(target.dsn), signed.jwk);
  await saveEvidence("native-workerd-startup-timing", { readyMs: performance.now() - started });
}, hookTimeoutMs(SPIKE_SETUP_BUDGET));

roleBootTest.beforeEach(async ({ roleBoot }) => {
  const plane = dataPlane();
  await roleBoot.hold(async () => {
    await migratorRole(plane.client, plane.dsn);
    await grantDatabaseCreate(plane.client, plane.dsn);
  });
});

afterAll(async () => {
  await settleTeardown([
    async () => resources.runtime?.close(),
    async () => client?.end(),
    async () => target?.stop(),
    async () => rm(resources.directory ?? "/nonexistent-native-worker-test", { recursive: true, force: true }),
  ]);
});

function post(path: string, body = requestMetadata) {
  return runtime.worker.dispatchFetch(`https://migrator.test/${path}`, { method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(body) });
}

async function applyReceipt() {
  const response = await post("migrate");
  // Miniflare requires immediate consumption of each dispatchFetch body.
  return { status: response.status, body: await response.json() as {
    prisma: { markerHash: string; migrationsApplied: number };
  } };
}

roleBootTest("runs authenticated preview and concurrent apply through the deployed entry and fixed DO with a non-superuser role", async ({ roleBoot }) => {
  const started = performance.now();
  const health = await runtime.worker.dispatchFetch("https://migrator.test/healthz");
  expect(await health.json()).toMatchObject({ prismaTarget: TARGET });
  const healthy = performance.now();
  const preview = await post("preflight");
  const previewBody: unknown = await preview.json();
  const sealedCount = (previewBody as { prisma: { migrations: unknown[] } }).prisma.migrations.length;
  expect({ status: preview.status, body: previewBody }).toMatchObject({ status: 200, body: {
    compatible: true, prisma: { targetHash: TARGET, markerHash: "empty", usedLiveMarker: true },
  } });
  const previewed = performance.now();
  const applied = await roleBoot.hold(() => Promise.all([applyReceipt(), applyReceipt()]));
  expect(applied.map((response) => response.status)).toEqual([200, 200]);
  const bodies = applied.map((response) => response.body);
  expect(bodies.map((body) => body.prisma.markerHash)).toEqual([TARGET, TARGET]);
  expect(bodies.map((body) => body.prisma.migrationsApplied).sort()).toEqual([0, sealedCount]);
  const migrated = performance.now();
  const replay = await post("preflight");
  const replayBody: unknown = await replay.json();
  expect(replayBody).toMatchObject({ prisma: { markerHash: TARGET, migrations: [], usedLiveMarker: true } });
  const replayed = performance.now();
  await saveEvidence("native-workerd-phase-timing", { healthMs: healthy - started,
    previewMs: previewed - healthy, concurrentApplyMs: migrated - previewed,
    replayMs: replayed - migrated, totalMs: replayed - started });
  await saveEvidence("native-workerd-fixed-lock", { applied, replay: replayBody });
}, SPIKE_SETUP_BUDGET.chainMarginMs);

/* The 2026-09-22 staging failure, against the real data plane (#1868). The apply here is the
 * deployed bundle's own — real graph, real Prisma control client, real PostgreSQL, real fixed
 * Durable Object — and only the answer time of one round trip is the test's, because that is
 * what made staging's apply slow in the first place. Inside `blockConcurrencyWhile` the
 * platform cancels this at 30 s and resets the object, and the route answers
 * `500 {"error":"apply_dispatch_failed"}` carrying that reset as its cause; the gate this
 * object uses now has no such bound, so the apply returns its marker. */
roleBootTest("applies through a round trip that outlasts the platform's blocked-callback cap", async ({ roleBoot }) => {
  runtime.latency.nextRoundTripMs = PAST_THE_CALLBACK_CAP_MS;
  const started = performance.now();
  const response = await roleBoot.hold(() => post("migrate"));
  const body: unknown = await response.json();
  const elapsedMs = performance.now() - started;
  // An apply that came back early would satisfy the status assertion against no bound at all.
  expect(elapsedMs).toBeGreaterThan(CALLBACK_CAP_MS);
  expect({ status: response.status, body }).toMatchObject({ status: 200, body: {
    success: true, prisma: { markerHash: TARGET },
  } });
  await saveEvidence("native-workerd-past-callback-cap", { elapsedMs, body });
});

roleBootTest("rejects a requested native target absent from the sealed graph before reading a database", async ({ roleBoot }) => {
  const response = await roleBoot.hold(() => post("migrate", { ...requestMetadata, expectedPrismaRef: "f".repeat(64) }));
  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({ error: "stale_prisma_bundle", prismaTarget: TARGET });
});
