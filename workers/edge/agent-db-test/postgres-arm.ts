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

/**
 * The one wall-clock budget the whole setup draws from.
 *
 * The image needs more than testcontainers' 60s default whenever it runs
 * emulated (the published tag is linux/amd64, so an arm64 developer machine
 * runs the whole PostGIS init under qemu). Giving the port bind its own 240s
 * and each connection wait its own 60s meant three independent timeouts for one
 * `before` hook to hold: 240 + 60 + 60 already outlives a 300s hook, so a slow
 * boot killed the lane instead of failing the phase that overran. Here the
 * phases share this deadline — the port bind is capped by all of it, and each
 * wait by whatever the bind left behind.
 */
export const SETUP_DEADLINE_MS = 240_000;

/**
 * The clean database and the Atlas chain run after the deadline's phases, over
 * a local socket with no network — seconds in practice. This is their room, and
 * the room for an exhausted budget to throw and be read as an error.
 */
const CHAIN_MARGIN_MS = 60_000;

/** What a `before` hook awaiting `startAgentDataPlane()` must allow. */
export const SETUP_HOOK_TIMEOUT_MS = SETUP_DEADLINE_MS + CHAIN_MARGIN_MS;

const CONNECTION_ATTEMPT_INTERVAL_MS = 1_000;
const MAX_CONNECTION_ATTEMPTS = 60;

/** How much of `SETUP_DEADLINE_MS` is left, and what a phase may spend of it. */
export class SetupBudget {
  readonly #now: () => number;
  readonly #startedAt: number;

  constructor(now: () => number = Date.now) {
    this.#now = now;
    this.#startedAt = now();
  }

  remainingMs(): number {
    return Math.max(0, SETUP_DEADLINE_MS - (this.#now() - this.#startedAt));
  }

  /** One second buys one attempt, and the wait keeps its own ceiling. */
  connectionAttempts(): number {
    const affordable = Math.floor(this.remainingMs() / CONNECTION_ATTEMPT_INTERVAL_MS);
    return Math.min(MAX_CONNECTION_ATTEMPTS, affordable);
  }
}

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
async function waitForConnections(dsn: string, budget: SetupBudget): Promise<void> {
  const attempts = budget.connectionAttempts();
  for (let attempt = 0; attempt < attempts; attempt++) {
    const settled = await connects(dsn);
    if (settled) return;
    await new Promise((resolve) => setTimeout(resolve, CONNECTION_ATTEMPT_INTERVAL_MS));
  }
  throw new Error(`PostgreSQL never accepted connections on ${dsn} within the setup budget`);
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

/** Boot the offline image, capped by what the setup budget still allows. */
function bootOfflinePostgres(budget: SetupBudget): Promise<StartedTestContainer> {
  return new GenericContainer(OFFLINE_IMAGE)
    .withEnvironment({ POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_DB: POSTGRES_USER })
    .withExposedPorts(5432)
    .withStartupTimeout(budget.remainingMs())
    .start();
}

/** Boot the container, migrate a clean database, and hand back its transactions. */
export async function startAgentDataPlane(): Promise<AgentDataPlane> {
  const budget = new SetupBudget();
  const container = await bootOfflinePostgres(budget);
  const base = `postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@${container.getHost()}:${String(container.getMappedPort(5432))}/postgres`;
  await waitForConnections(base, budget);
  const dsn = await createCleanDatabase(base);
  await waitForConnections(dsn, budget);
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
