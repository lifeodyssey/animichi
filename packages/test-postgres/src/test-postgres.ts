/** One disposable PostgreSQL + PostGIS + pgvector data plane, migrated and ready.
 *
 * Boot the offline image, wait for the server to accept sessions rather than
 * merely to bind the port, create a CLEAN database from `template1`, apply the
 * committed `migrations/neon` Atlas chain, and hand back its DSN. Zero Neon
 * environment variables, zero network beyond the local daemon.
 *
 * The container is REUSED (#1663): `.withReuse()` keys it on the image and the
 * create options, so every arm in every worktree on this host shares one server
 * and pays the emulated initdb once — and the server keeps running between runs.
 * The isolation unit is therefore the DATABASE, never the container: each call
 * owns a uniquely named database, and `stop()` drops that database alone. A
 * failure after the database exists drops it too, instead of the server.
 *
 * The bind and the two waits draw on ONE wall-clock deadline (#1318), so they
 * cannot sum past the hook that holds them. The chain apply holds the cluster's
 * turn while it runs, because the chain writes cluster-global roles (#1663).
 */
import pg from "pg";
import { GenericContainer, Wait, type StartedTestContainer, type WaitStrategy } from "testcontainers";
import { applyAtlasChain } from "./atlas-chain.ts";
import { ChainApplyTurn } from "./chain-apply-turn.ts";
import { createCleanDatabase, dropCleanDatabase } from "./clean-database.ts";
import { uniqueDatabaseName } from "./database-name.ts";
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

/** What a suite asks for: the base of its own database name, on its own budget. */
export interface TestPostgresRequest {
  readonly database: string;
  readonly budget: SetupBudget;
}

export interface TestPostgres {
  readonly dsn: string;
  /** Drop this call's database. The reused server keeps running (#1663). */
  stop(): Promise<void>;
}

/** One call's own database on the shared server, and how to remove it. */
interface OwnDatabase {
  readonly admin: string;
  readonly name: string;
  drop(): Promise<void>;
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

/** The bind is offered everything the deadline has not spent yet.
 *
 * `.withReuse()` keys the container on the hash of Docker's create options —
 * image, environment, exposed ports, labels — and on neither the wait strategy
 * nor the startup timeout below. Every arm reaches the same container, and a
 * new image tag or a testcontainers upgrade reaches a new one. */
function bootContainer(deadline: SetupDeadline): Promise<StartedTestContainer> {
  return new GenericContainer(OFFLINE_POSTGRES_IMAGE)
    .withReuse()
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

/** The call's own database: a fresh name on the shared server, plus its drop. */
function ownDatabase(container: StartedTestContainer, suite: string): OwnDatabase {
  const admin = adminDsn(container);
  const name = uniqueDatabaseName(suite);
  return { admin, name, drop: () => dropCleanDatabase(admin, name) };
}

/** `CREATE DATABASE` returns before the new database accepts its own sessions,
 * so the clean DSN is probed too — the reason `db-fresh-schema.sh` waits twice. */
async function migrateCleanDatabase(own: OwnDatabase, deadline: SetupDeadline): Promise<TestPostgres> {
  await awaitSessions(own.admin, deadline);
  const dsn = await createCleanDatabase(own.admin, own.name);
  await awaitSessions(dsn, deadline);
  await new ChainApplyTurn(own.admin).hold(() => applyAtlasChain(dsn));
  return { dsn, stop: () => own.drop() };
}

/** A failing drop must not replace the failure that caused it: the original
 * error is the diagnosis the lane has to read. */
async function dropWithoutMaskingFailure(own: OwnDatabase): Promise<void> {
  try {
    await own.drop();
  } catch {
    // best-effort: the failure being propagated is the one that matters
  }
}

/** Boot the shared server, prepare the call's own clean DB + Atlas chain, hand it over. */
export async function startTestPostgres(request: TestPostgresRequest): Promise<TestPostgres> {
  const deadline = new SetupDeadline(request.budget);
  const own = ownDatabase(await bootContainer(deadline), request.database);
  try {
    return await migrateCleanDatabase(own, deadline);
  } catch (failure) {
    await dropWithoutMaskingFailure(own);
    throw failure;
  }
}
