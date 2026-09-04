/** Hermetic Docker Postgres + PostGIS arm for the catalog spike suite.
 *
 * Mirrors apps/agent's offline Docker arm (docs/ops/neon-test-infra.md): boot
 * the pgvector-extended postgis image, create a CLEAN database from template1
 * (the base image pre-initialises its default DB with the postgis tiger/topology
 * schemas, which Atlas's clean-check refuses), then apply the committed
 * migrations/neon Atlas chain — the continuous chain-applies-cleanly check.
 * Zero Neon environment variables. */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import pg from "pg";
import { GenericContainer, Wait, type StartedTestContainer, type WaitStrategy } from "testcontainers";
import { PostgresStartupWait, SPIKE_STARTUP_WAIT, type Pause } from "./postgres-startup-wait";

export const OFFLINE_IMAGE = "animichi-test-postgres:18-3.6-pgvector-0.8.5";
export const POSTGRES_USER = "postgres";
export const POSTGRES_PASSWORD = "postgres";
const CLEAN_DATABASE = "catalog_spike";
const MIGRATIONS_DIR = new URL("../../../../migrations/neon/", import.meta.url);
/** The image's entrypoint logs this once for the initdb server it shuts down
 * again, and once for the server that finally binds TCP — so the second
 * occurrence is the one that means "connect now". */
const READY_LOG = /database system is ready to accept connections/;
const READY_LOG_OCCURRENCES = 2;
/** The published image is linux/amd64: on an arm64 host initdb runs emulated
 * and can cross testcontainers' 60s default on a container that is fine
 * (workers/edge/agent-db-test/postgres-arm.ts allows the same budget). */
const STARTUP_TIMEOUT_MS = 240_000;

export interface DockerDataPlane {
  dsn: string;
  stop: () => Promise<void>;
}

function atlasBinary(): string {
  return process.env.ATLAS_BIN ?? "atlas";
}

/** Apply the committed migrations/neon chain to a clean database. */
export async function applyAtlasChain(dsn: string): Promise<void> {
  const run = promisify(execFile);
  await run(atlasBinary(), [
    "migrate", "apply",
    "--dir", MIGRATIONS_DIR.href,
    "--url", dsn,
    "--revisions-schema", "public",
  ], {
    env: { ...process.env, ATLAS_NO_UPDATE_NOTIFIER: "1" },
    maxBuffer: 10 * 1024 * 1024,
  });
}

/** Create a clean database from template1 so the chain applies to an empty one. */
export async function createCleanDatabase(baseDsn: string, name: string): Promise<string> {
  const client = new pg.Client(baseDsn);
  await client.connect();
  try {
    await client.query(`CREATE DATABASE "${name}" TEMPLATE template1`);
  } finally {
    await client.end();
  }
  const before = baseDsn.split("/").slice(0, 3).join("/");
  return `${before}/${name}?sslmode=disable`;
}

/** Both the published port and the second readiness log line, not just the port. */
function acceptsSessionsWait(): WaitStrategy {
  return Wait.forAll([
    Wait.forListeningPorts(),
    Wait.forLogMessage(READY_LOG, READY_LOG_OCCURRENCES),
  ]);
}

const sleep: Pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

/** One session against the server: the probe the startup wait repeats. */
async function openSession(dsn: string): Promise<void> {
  const client = new pg.Client(dsn);
  try {
    await client.connect();
    await client.query("select 1");
  } finally {
    await client.end().catch(() => undefined);
  }
}

function bootContainer(): Promise<StartedTestContainer> {
  return new GenericContainer(OFFLINE_IMAGE)
    .withEnvironment({ POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_DB: POSTGRES_USER })
    .withExposedPorts(5432)
    .withWaitStrategy(acceptsSessionsWait())
    .withStartupTimeout(STARTUP_TIMEOUT_MS)
    .start();
}

async function migrateCleanDatabase(container: StartedTestContainer): Promise<DockerDataPlane> {
  const base = `postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@${container.getHost()}:${String(container.getMappedPort(5432))}/postgres`;
  await new PostgresStartupWait(SPIKE_STARTUP_WAIT, sleep).until(() => openSession(base));
  const clean = await createCleanDatabase(base, CLEAN_DATABASE);
  await applyAtlasChain(clean);
  return { dsn: clean, stop: () => container.stop().then(() => undefined) };
}

/** Boot the offline container, prepare the clean DB + Atlas chain, then stop. */
export async function startDataPlane(): Promise<DockerDataPlane> {
  const container = await bootContainer();
  try {
    return await migrateCleanDatabase(container);
  } catch (failure) {
    await container.stop();
    throw failure;
  }
}
