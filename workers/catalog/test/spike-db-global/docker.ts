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
import { GenericContainer, type StartedTestContainer } from "testcontainers";

export const OFFLINE_IMAGE = "animichi-test-postgres:18-3.6-pgvector-0.8.5";
export const POSTGRES_USER = "postgres";
export const POSTGRES_PASSWORD = "postgres";
const CLEAN_DATABASE = "catalog_spike";
const MIGRATIONS_DIR = new URL("../../../../migrations/neon/", import.meta.url);

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

/** Boot the offline container, prepare the clean DB + Atlas chain, then stop. */
export async function startDataPlane(): Promise<DockerDataPlane> {
  const container: StartedTestContainer = await new GenericContainer(OFFLINE_IMAGE)
    .withEnvironment({ POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_DB: POSTGRES_USER })
    .withExposedPorts(5432)
    .start();
  const host = container.getHost();
  const port = container.getMappedPort(5432);
  const clean = await createCleanDatabase(`postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@${host}:${String(port)}/postgres`, CLEAN_DATABASE);
  await applyAtlasChain(clean);
  return { dsn: clean, stop: () => container.stop().then(() => undefined) };
}
