/** One disposable PostgreSQL + PostGIS + pgvector data plane, migrated and ready.
 *
 * Boot the offline image, wait for the server to accept sessions rather than
 * merely to bind the port, create a CLEAN database from `template1`, apply the
 * committed `migrations/neon` Atlas chain, and hand back its DSN. Zero Neon
 * environment variables, zero network beyond the local daemon.
 *
 * The bind and the two waits draw on ONE wall-clock deadline (#1318), so they
 * cannot sum past the hook that holds them; a failure anywhere after `.start()`
 * stops the container before it propagates, so a red gate run leaves nothing
 * behind (#1324).
 */
import pg from "pg";
import { GenericContainer, Wait, type StartedTestContainer, type WaitStrategy } from "testcontainers";
import { applyAtlasChain } from "./atlas-chain.ts";
import { createCleanDatabase } from "./clean-database.ts";
import { OFFLINE_POSTGRES_IMAGE } from "./postgres-image.ts";
import { PostgresStartupWait, type Pause } from "./postgres-startup-wait.ts";
import type { SetupBudget } from "./setup-budget.ts";
import { SetupDeadline } from "./setup-deadline.ts";

export const POSTGRES_USER = "postgres";
export const POSTGRES_PASSWORD = "postgres";
const POSTGRES_PORT = 5432;
/** The image's entrypoint logs this once for the initdb server it shuts down
 * again, and once for the server that finally binds TCP — so the second
 * occurrence is the one that means "connect now". */
const READY_LOG = /database system is ready to accept connections/;
const READY_LOG_OCCURRENCES = 2;

/** What a suite asks for: its own database name, on its own budget. */
export interface TestPostgresRequest {
  readonly database: string;
  readonly budget: SetupBudget;
}

export interface TestPostgres {
  readonly dsn: string;
  stop(): Promise<void>;
}

const sleep: Pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

/** Both the published port and the second readiness log line, not just the port. */
function acceptsSessionsWait(): WaitStrategy {
  return Wait.forAll([
    Wait.forListeningPorts(),
    Wait.forLogMessage(READY_LOG, READY_LOG_OCCURRENCES),
  ]);
}

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

function awaitSessions(dsn: string, deadline: SetupDeadline): Promise<void> {
  const wait = new PostgresStartupWait(deadline.firstSessionLimits(), sleep);
  return wait.until(() => openSession(dsn));
}

/** The bind is offered everything the deadline has not spent yet. */
function bootContainer(deadline: SetupDeadline): Promise<StartedTestContainer> {
  return new GenericContainer(OFFLINE_POSTGRES_IMAGE)
    .withEnvironment({ POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_DB: POSTGRES_USER })
    .withExposedPorts(POSTGRES_PORT)
    .withWaitStrategy(acceptsSessionsWait())
    .withStartupTimeout(deadline.remainingMs())
    .start();
}

/** The admin database the image pre-initialises — never the migration target. */
function adminDsn(container: StartedTestContainer): string {
  const host = `${container.getHost()}:${String(container.getMappedPort(POSTGRES_PORT))}`;
  return `postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@${host}/${POSTGRES_USER}`;
}

/** `CREATE DATABASE` returns before the new database accepts its own sessions,
 * so the clean DSN is probed too — the reason `db-fresh-schema.sh` waits twice. */
async function migrateCleanDatabase(
  container: StartedTestContainer,
  request: TestPostgresRequest,
  deadline: SetupDeadline,
): Promise<TestPostgres> {
  const admin = adminDsn(container);
  await awaitSessions(admin, deadline);
  const dsn = await createCleanDatabase(admin, request.database);
  await awaitSessions(dsn, deadline);
  await applyAtlasChain(dsn);
  return { dsn, stop: () => container.stop().then(() => undefined) };
}

/** Boot the offline container, prepare the clean DB + Atlas chain, then hand it over. */
export async function startTestPostgres(request: TestPostgresRequest): Promise<TestPostgres> {
  const deadline = new SetupDeadline(request.budget);
  const container = await bootContainer(deadline);
  try {
    return await migrateCleanDatabase(container, request, deadline);
  } catch (failure) {
    await container.stop();
    throw failure;
  }
}
