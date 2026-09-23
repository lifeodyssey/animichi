import {
  createMigratedDatabase,
  dropCleanDatabase,
  SPIKE_SETUP_BUDGET,
  startTestPostgresCluster,
  uniqueDatabaseName,
  type TestPostgresCluster,
} from "@animichi/test-postgres";
import type { TestProject } from "vitest/node";

/**
 * Suite setup for the hermetic Docker Postgres arm (card 1049): boot the
 * pgvector-extended postgis container and provide every integration test file
 * with a migrated database. Any failure in this setup throws — the old
 * silent-skip mode is removed (AC2).
 *
 * ONE database — `<suite>_plane`, the committed Prisma chain (#1626), the shape
 * every real environment has. The second one this file used to build, the frozen
 * Drizzle-era catalog, went with #1633: the query layer that needed it (the
 * files writing `points.latitude` / `longitude` as plain scalars, the staging
 * import above all) is on the plane now, where those two are generated columns.
 *
 * It is NOT the plane's own database (`startTestPostgres` migrates that one):
 * one chain per database, and a suite that migrated the plane's database would
 * be the `MIGRATION.MARKER_MISMATCH` #1625 removed — and would collide with every
 * other arm sharing the container. The suite database is a CLONE of the
 * container's migrated template (#1769), so it costs no chain apply of its own
 * and does not queue on the cluster turn.
 *
 * The recipe itself is `@animichi/test-postgres` (#1326), shared with the edge's
 * agent-db arm and with `scripts/local-gates/db-fresh-schema.sh`. What stays this
 * arm's own is the database names and `SPIKE_SETUP_BUDGET`: one container serves
 * the whole suite, so it probes 30 × 1 s.
 */
const PLANE_DATABASE = "catalog_integration_plane";

export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const cluster = await startTestPostgresCluster({ budget: SPIKE_SETUP_BUDGET });
  const plane = uniqueDatabaseName(PLANE_DATABASE);
  try {
    const planeDsn = await createMigratedDatabase(cluster.adminDsn, plane);
    project.provide("integrationDatabase", { enabled: true, planeDsn });
  } catch (failure) {
    await dropWithoutMaskingFailure(cluster, plane);
    throw failure;
  }
  return () => dropWithoutMaskingFailure(cluster, plane);
}

/** Drop the suite database. A drop with nothing to drop — the failure happened
 * before the create — must not replace the failure that caused the teardown. */
async function dropWithoutMaskingFailure(cluster: TestPostgresCluster, plane: string): Promise<void> {
  await dropCleanDatabase(cluster.adminDsn, plane);
}
