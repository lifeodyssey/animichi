/**
 * The disposable PostgreSQL arm for the edge's agent-tier statements (#1251).
 *
 * Same recipe the repo already sanctions elsewhere — `workers/catalog`'s spike
 * suite and `scripts/local-gates/db-fresh-schema.sh`: boot the offline
 * postgis+pgvector image, create a CLEAN database from `template1` (the image
 * pre-initialises its default database with the tiger/topology schemas, which
 * the Atlas chain refuses), then apply the committed `migrations/neon` chain.
 * Zero Neon credentials, zero network.
 *
 * The intake's statements run here through `drizzle-orm/node-postgres`, and in
 * production through `drizzle-orm/neon-serverless`. Both are pg-core drivers
 * over the same wire protocol reading the same `src/db/schema.ts` mapping, so
 * what is proven here is the SQL and the transaction semantics themselves —
 * only the connection adapter differs.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import { GenericContainer, type StartedTestContainer } from "testcontainers";
import type { AgentStatements, AgentTransactions } from "../src/db/agent-database.ts";

const OFFLINE_IMAGE = "animichi-test-postgres:18-3.6-pgvector-0.8.5";
const POSTGRES_USER = "postgres";
const POSTGRES_PASSWORD = "postgres";
const CLEAN_DATABASE = "edge_agent";
const MIGRATIONS_DIR = new URL("../../../migrations/neon/", import.meta.url);

export interface AgentDataPlane {
  readonly transactions: AgentTransactions;
  readonly database: NodePgDatabase;
  stop(): Promise<void>;
}

/** Apply the committed migrations/neon chain to a clean database. */
async function applyAtlasChain(dsn: string): Promise<void> {
  await promisify(execFile)(process.env.ATLAS_BIN ?? "atlas", [
    "migrate", "apply",
    "--dir", MIGRATIONS_DIR.href,
    "--url", dsn,
    "--revisions-schema", "public",
  ], { env: { ...process.env, ATLAS_NO_UPDATE_NOTIFIER: "1" }, maxBuffer: 10 * 1024 * 1024 });
}

/**
 * The image's entrypoint serves its init scripts on a Unix socket first, so a
 * mapped port can accept a connection while the final server is still starting
 * ("the database system is starting up", SQLSTATE 57P03). `db-fresh-schema.sh`
 * probes TCP for the same reason; this is that probe.
 */
async function waitForConnections(dsn: string): Promise<void> {
  for (let attempt = 0; attempt < 60; attempt++) {
    const settled = await connects(dsn);
    if (settled) return;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error(`PostgreSQL never accepted connections on ${dsn}`);
}

async function connects(dsn: string): Promise<boolean> {
  const client = new pg.Client(dsn);
  try {
    await client.connect();
    await client.query("select 1");
    return true;
  } catch {
    return false;
  } finally {
    await client.end().catch(() => undefined);
  }
}

/** Create the target database from pristine template1 and return its DSN. */
async function createCleanDatabase(baseDsn: string): Promise<string> {
  const client = new pg.Client(baseDsn);
  await client.connect();
  try {
    await client.query(`CREATE DATABASE "${CLEAN_DATABASE}" TEMPLATE template1`);
  } finally {
    await client.end();
  }
  return `${baseDsn.split("/").slice(0, 3).join("/")}/${CLEAN_DATABASE}?sslmode=disable`;
}

function transactionsOn(database: NodePgDatabase): AgentTransactions {
  return { run: (work) => database.transaction((tx: AgentStatements) => work(tx)) };
}

/** Boot the container, migrate a clean database, and hand back its transactions. */
export async function startAgentDataPlane(): Promise<AgentDataPlane> {
  const container: StartedTestContainer = await new GenericContainer(OFFLINE_IMAGE)
    .withEnvironment({ POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_DB: POSTGRES_USER })
    .withExposedPorts(5432)
    .start();
  const base = `postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@${container.getHost()}:${String(container.getMappedPort(5432))}/postgres`;
  await waitForConnections(base);
  const dsn = await createCleanDatabase(base);
  await waitForConnections(dsn);
  await applyAtlasChain(dsn);
  const pool = new pg.Pool({ connectionString: dsn });
  const database = drizzle(pool);
  return {
    transactions: transactionsOn(database),
    database,
    stop: async () => {
      await pool.end();
      await container.stop();
    },
  };
}
