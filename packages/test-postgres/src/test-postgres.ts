/** One disposable PostgreSQL + PostGIS + pgvector data plane, migrated and ready.
 *
 * Open the shared cluster (`test-postgres-cluster.ts`: the server, reused, with
 * its five service roles), create a CLEAN database from `template1`, apply the
 * committed Prisma chain, and hand back its DSN. Zero Neon environment
 * variables, zero network beyond the local daemon. A suite that only creates
 * databases of its own does not need this — it asks for the cluster (#1783).
 *
 * The isolation unit is the DATABASE, never the container (#1663): each call
 * owns a uniquely named database, and `stop()` drops that database alone. A
 * failure after the database exists drops it too, instead of the server.
 *
 * The bind and the three waits draw on ONE wall-clock deadline (#1318), so they
 * cannot sum past the hook that holds them. The chain apply holds the cluster's
 * turn, and runs after the cluster's own turn committed the roles its grant
 * matrix prechecks (#1663).
 */
import { ChainApplyTurn } from "./chain-apply-turn.ts";
import { createCleanDatabase, dropCleanDatabase } from "./clean-database.ts";
import { uniqueDatabaseName } from "./database-name.ts";
import { applyPrismaChain } from "./prisma-chain.ts";
import type { SetupBudget } from "./setup-budget.ts";
import { SetupDeadline } from "./setup-deadline.ts";
import { awaitSessions, openCluster, type TestPostgresCluster } from "./test-postgres-cluster.ts";

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

/** The call's own database: a fresh name on the shared server, plus its drop. */
function ownDatabase(cluster: TestPostgresCluster, suite: string): OwnDatabase {
  const admin = cluster.adminDsn;
  const name = uniqueDatabaseName(suite);
  return { admin, name, drop: () => dropCleanDatabase(admin, name) };
}

/** `CREATE DATABASE` returns before the new database accepts its own sessions,
 * so the clean DSN is probed too — the reason `db-fresh-schema.sh` waits twice. */
async function migrateCleanDatabase(own: OwnDatabase, deadline: SetupDeadline): Promise<TestPostgres> {
  const dsn = await createCleanDatabase(own.admin, own.name);
  await awaitSessions(dsn, deadline);
  await new ChainApplyTurn(own.admin).hold(() => applyPrismaChain(dsn));
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

/** Open the shared cluster, prepare the call's own clean DB + chain, hand it over. */
export async function startTestPostgres(request: TestPostgresRequest): Promise<TestPostgres> {
  const deadline = new SetupDeadline(request.budget);
  const own = ownDatabase(await openCluster(deadline), request.database);
  try {
    return await migrateCleanDatabase(own, deadline);
  } catch (failure) {
    await dropWithoutMaskingFailure(own);
    throw failure;
  }
}
