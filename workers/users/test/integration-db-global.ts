import {
  createMigratedDatabase,
  dropCleanDatabase,
  SPIKE_SETUP_BUDGET,
  startTestPostgresCluster,
  uniqueDatabaseName,
} from "@animichi/test-postgres";
import type { TestProject } from "vitest/node";

/**
 * Suite setup for the users worker's Docker Postgres arm (#1632).
 *
 * ONE database, cloned from the container's migrated template (#1769): the
 * `saved_routes` / `saved_route_idempotency` tables come from the committed
 * Prisma chain (#1626), which is the shape every real environment has. It is a
 * CLONE, so it costs no chain apply of its own and does not queue on the
 * cluster turn.
 *
 * The container is shared (`@animichi/test-postgres`, #1663) and the database
 * is this suite's own, so any failure in this setup throws — the old
 * silent-skip mode stays removed.
 */
const DATABASE = "users_integration";

export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const cluster = await startTestPostgresCluster({ budget: SPIKE_SETUP_BUDGET });
  const owned = uniqueDatabaseName(DATABASE);
  try {
    const dsn = await createMigratedDatabase(cluster.adminDsn, owned);
    project.provide("integrationDatabase", { enabled: true, dsn });
  } catch (failure) {
    await dropCleanDatabase(cluster.adminDsn, owned);
    throw failure;
  }
  return () => dropCleanDatabase(cluster.adminDsn, owned);
}
