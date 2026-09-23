/** The shared PostgreSQL + PostGIS + pgvector server, reached and provisioned.
 *
 * Boot (or reuse) the offline image, wait for the server to accept sessions
 * rather than merely to bind the port, and create the five service roles: what
 * every database-backed suite needs before it creates a database of its own
 * (#1783). No database is created here and no chain is applied — a suite that
 * reads the data plane's schema asks `startTestPostgres` for it instead.
 *
 * The container is REUSED (#1663): `.withReuse()` keys it on the image and the
 * create options, so every arm in every worktree on this host shares one server
 * and pays the emulated initdb once — and the server keeps running between runs.
 * So a cluster has nothing to stop: an arm never stops the server, and it drops
 * the databases it created itself.
 *
 * The bind and the admin wait draw on ONE wall-clock deadline (#1318). The role
 * creation holds the cluster's turn: the roles are cluster-global and created
 * check-then-create (#1663).
 */
import pg from "pg";
import { GenericContainer, Wait, type StartedTestContainer, type WaitStrategy } from "testcontainers";
import { ChainApplyTurn } from "./chain-apply-turn.ts";
import { OFFLINE_POSTGRES_IMAGE } from "./postgres-image.ts";
import { PostgresStartupWait, type Pause } from "./postgres-startup-wait.ts";
import { assertServiceRoles, createServiceRoles } from "./service-roles.ts";
import type { SetupBudget } from "./setup-budget.ts";
import { SetupDeadline } from "./setup-deadline.ts";

export const POSTGRES_USER = "postgres";
export const POSTGRES_PASSWORD = "test";
const POSTGRES_PORT = 5432;
/** The image's entrypoint logs this once for the initdb server it shuts down
 * again, and once for the server that finally binds TCP — so the second
 * occurrence is the one that means "connect now". */
const READY_LOG = /database system is ready to accept connections/;
const READY_LOG_OCCURRENCES = 2;

/** What a suite asks the cluster for: nothing but its own budget. */
export interface TestPostgresClusterRequest {
  readonly budget: SetupBudget;
}

export interface TestPostgresCluster {
  /** The image's default database: where a suite creates and drops its own. */
  readonly adminDsn: string;
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

export function awaitSessions(dsn: string, deadline: SetupDeadline): Promise<void> {
  const wait = new PostgresStartupWait(deadline.firstSessionLimits(), sleep);
  return wait.until(() => openSession(dsn));
}

/** The bind is offered everything the deadline has not spent yet.
 *
 * `.withReuse()` keys the container on the hash of Docker's create options —
 * image, environment, exposed ports, labels — and on neither the wait strategy
 * nor the startup timeout below. Every arm reaches the same container, and a
 * new image tag or a testcontainers upgrade reaches a new one. `shared` false
 * boots a container of one's own instead, which no other suite ever reaches. */
function bootContainer(deadline: SetupDeadline, shared: boolean): Promise<StartedTestContainer> {
  const boot = new GenericContainer(OFFLINE_POSTGRES_IMAGE)
    .withEnvironment({ POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_DB: POSTGRES_USER })
    .withExposedPorts(POSTGRES_PORT)
    .withWaitStrategy(acceptsSessionsWait())
    .withStartupTimeout(deadline.remainingMs());
  return (shared ? boot.withReuse() : boot).start();
}

/** The admin database the image pre-initialises — never a migration target. */
function adminDsnOf(container: StartedTestContainer): string {
  const host = `${container.getHost()}:${String(container.getMappedPort(POSTGRES_PORT))}`;
  return `postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@${host}/${POSTGRES_USER}`;
}

/** The same connection, named for what it is to a caller that has only a plane's
 * DSN: the image's default database (`POSTGRES_DB` in `bootContainer`), which is
 * the database every advisory-lock holder on the cluster shares (#1663) — an
 * advisory lock is scoped to the database that issued it, so a lock taken on a
 * suite's own database conflicts with nobody. */
export function clusterAdminDsn(planeDsn: string): string {
  const url = new URL(planeDsn);
  url.pathname = `/${POSTGRES_USER}`;
  return url.toString();
}

/** The roles are created, then asserted by name, inside the cluster's turn. The
 * assertion is its own step, not part of the create: with the creation removed,
 * the failure has to name the roles that are missing. */
async function provisionServiceRoles(admin: string): Promise<void> {
  await new ChainApplyTurn(admin).hold(async () => {
    await createServiceRoles(admin);
    await assertServiceRoles(admin);
  });
}

/** A cluster the caller owns: a container shared with nobody, and none of the
 * service roles on it. The shared cluster's boot creates the five roles itself,
 * so "starting with no service roles" can never be observed there (#1915) —
 * this is the from-nothing starting point a proof of that claim boots.
 *
 * Nothing provisions anything: a service role that exists on this cluster
 * afterwards is one the caller's own code created, which is the fact such a
 * proof reads. */
export interface OwnedPostgresCluster extends TestPostgresCluster {
  /** Stop the container. The caller booted it alone, so the caller ends it; a
   * crash before `stop` leaves it to testcontainers' reaper instead. */
  stop(): Promise<void>;
}

export async function startOwnedPostgresCluster(request: TestPostgresClusterRequest): Promise<OwnedPostgresCluster> {
  const deadline = new SetupDeadline(request.budget);
  const container = await bootContainer(deadline, false);
  const adminDsn = adminDsnOf(container);
  await awaitSessions(adminDsn, deadline);
  return { adminDsn, stop: async () => { await container.stop(); } };
}

/** The cluster on a deadline the caller may go on spending (`startTestPostgres`). */
export async function openCluster(deadline: SetupDeadline): Promise<TestPostgresCluster> {
  const admin = adminDsnOf(await bootContainer(deadline, true));
  await awaitSessions(admin, deadline);
  await provisionServiceRoles(admin);
  return { adminDsn: admin };
}

/** Boot or reuse the shared server and provision its service roles — no database, no chain. */
export function startTestPostgresCluster(request: TestPostgresClusterRequest): Promise<TestPostgresCluster> {
  return openCluster(new SetupDeadline(request.budget));
}
