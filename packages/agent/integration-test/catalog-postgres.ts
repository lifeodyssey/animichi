import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { TestContext } from "node:test";
import { neon, neonConfig } from "@neondatabase/serverless";
import { GenericContainer, Wait } from "testcontainers";
import {
  applyDrizzleEraCatalog,
  createCleanDatabase,
  dropCleanDatabase,
  SPIKE_SETUP_BUDGET,
  startTestPostgresCluster,
  uniqueDatabaseName,
  type TestPostgresCluster,
} from "@animichi/test-postgres";

// Published multi-platform packaging of upstream Neon Proxy release-proxy-8853.
const IMAGE = "ghcr.io/timowilhelm/local-neon-http-proxy@sha256:cd2ae14edf2feafbc3330492de5c80506f77274c3bd013154cdef697bdeb768a";
const execute = promisify(execFile);

// WHAT this lane's database is, and why it is not the plane's own (#1625).
//
// The native tools are served by `workers/catalog`, whose Drizzle layer still reads and writes the
// pre-Prisma shape: `catalog-seed.ts` writes `points.latitude` / `longitude` as scalars and the
// worker's schema declares `points.embedding`. The data plane the Prisma chain builds makes the
// coordinates GENERATED and deliberately omits `embedding`, so this lane keeps a database of its
// OWN — from pristine `template1`, with the frozen fixture `@animichi/test-postgres` keeps for
// exactly these two lanes. It asks for the cluster alone (#1783): the server, its admin database
// and the five service roles, with no Prisma-migrated database beside this one that nothing reads.
//
// This is the same isolation answer as the catalog suite's (`workers/catalog/test/integration-db-global.ts`)
// and the same debt: #1628–#1631 move that query layer onto Prisma and delete this branch with it.
const LEGACY_DATABASE = "native_catalog_tools_legacy";

export async function catalogPostgres(context: TestContext) {
  const cluster = await startTestPostgresCluster({ budget: SPIKE_SETUP_BUDGET });
  const name = uniqueDatabaseName(LEGACY_DATABASE);
  try {
    const dsn = await openLegacyDatabase(cluster, name);
    context.after(() => dropCleanDatabase(cluster.adminDsn, name));
    const proxy = await startProxy(dsn);
    context.after(() => proxy.stop().then(() => undefined));
    const endpoint = `http://${proxy.getHost()}:${String(proxy.getMappedPort(4444))}/sql`;
    const connection = new URL(dsn); connection.hostname = "db.localtest.me"; connection.port = "5432";
    const previous = neonConfig.fetchEndpoint; neonConfig.fetchEndpoint = endpoint;
    context.after(() => { neonConfig.fetchEndpoint = previous; });
    return { connectionString: connection.href, endpoint, sql: neon(connection.href) };
  } catch (failure) {
    await dropWithoutMaskingFailure(cluster, name);
    throw failure;
  }
}

/** This lane's database: pristine `template1`, then the frozen Drizzle-era shape. */
async function openLegacyDatabase(cluster: TestPostgresCluster, name: string): Promise<string> {
  const dsn = await createCleanDatabase(cluster.adminDsn, name);
  await applyDrizzleEraCatalog(dsn);
  return dsn;
}

/** A drop that has nothing to drop — the failure above happened before the create — must not
 * replace the failure that caused it. */
async function dropWithoutMaskingFailure(cluster: TestPostgresCluster, name: string): Promise<void> {
  try {
    await dropCleanDatabase(cluster.adminDsn, name);
  } catch {
    // best-effort: the failure being propagated is the one that matters
  }
}

async function startProxy(dsn: string) {
  const upstream = new URL(dsn); upstream.hostname = await postgresAddress(upstream.port); upstream.port = "5432";
  return new GenericContainer(IMAGE).withEnvironment({ PG_CONNECTION_STRING: upstream.href }).withExposedPorts(4444)
    .withWaitStrategy(Wait.forAll([Wait.forLogMessage("serving initial configuration"),
      Wait.forSuccessfulCommand("bash -c '</dev/tcp/127.0.0.1/4445'")])).withStartupTimeout(60_000).start();
}

async function postgresAddress(port: string) {
  const listed = await execute("docker", ["ps", "--filter", `publish=${port}`, "--format", "{{.ID}}"]);
  const ids = listed.stdout.trim().split(/\s+/); assert.equal(ids.length, 1); assert.ok(ids[0]);
  const inspected = await execute("docker", ["inspect", ids[0]]);
  const containers = JSON.parse(inspected.stdout) as { NetworkSettings: { Networks: Record<string, { IPAddress: string }> } }[];
  assert.ok(containers[0]); const address = Object.values(containers[0].NetworkSettings.Networks)[0]?.IPAddress;
  assert.ok(address); return address;
}
