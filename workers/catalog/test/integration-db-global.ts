import {
  applyDrizzleEraCatalog,
  createCleanDatabase,
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
 * TWO databases, one per plane shape, both created from pristine `template1` on
 * the container the plane owns. The query layer is mid-migration, so which shape
 * a file needs depends on which tables it touches:
 *
 *   - `<suite>_legacy` — the frozen Drizzle-era catalog
 *     (`@animichi/test-postgres`'s `sql/drizzle-era-catalog.sql`). Every file
 *     that writes `points.latitude` / `longitude` as plain scalars or reads
 *     `points.embedding` still needs this shape — the #1626 data plane makes the
 *     first two generated and omits the third. Those reads are #1629–#1631's to
 *     move; the fixture is deleted with that branch.
 *   - `<suite>_plane` — the committed Prisma chain (#1626), the shape every real
 *     environment has. The nearby path moved onto it in #1628, so the
 *     `nearby-*.integration.test.ts` files run here.
 *
 * NEITHER is the plane's own database (`startTestPostgres` migrates that one):
 * one chain per database, and a suite that migrated the plane's database would
 * be the `MIGRATION.MARKER_MISMATCH` #1625 removed — and would collide with every
 * other arm sharing the container. The plane database is a CLONE of the
 * container's migrated template (#1769), so it costs no chain apply of its own
 * and does not queue on the cluster turn.
 *
 * The recipe itself is `@animichi/test-postgres` (#1326), shared with the edge's
 * agent-db arm and with `scripts/local-gates/db-fresh-schema.sh`. What stays this
 * arm's own is the database names and `SPIKE_SETUP_BUDGET`: one container serves
 * the whole suite, so it probes 30 × 1 s.
 */
const LEGACY_DATABASE = "catalog_integration_legacy";
const PLANE_DATABASE = "catalog_integration_plane";

/** The two databases this suite owns, by the names it created them under. */
interface SuiteDatabases {
  readonly legacy: string;
  readonly plane: string;
}

export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const cluster = await startTestPostgresCluster({ budget: SPIKE_SETUP_BUDGET });
  const owned: SuiteDatabases = {
    legacy: uniqueDatabaseName(LEGACY_DATABASE),
    plane: uniqueDatabaseName(PLANE_DATABASE),
  };
  try {
    project.provide("integrationDatabase", { enabled: true, ...(await buildDatabases(cluster, owned)) });
  } catch (failure) {
    await dropWithoutMaskingFailure(cluster, owned);
    throw failure;
  }
  return () => dropWithoutMaskingFailure(cluster, owned);
}

/** Create both databases and hand back their DSNs. */
async function buildDatabases(
  cluster: TestPostgresCluster,
  owned: SuiteDatabases,
): Promise<{ readonly dsn: string; readonly planeDsn: string }> {
  const dsn = await createCleanDatabase(cluster.adminDsn, owned.legacy);
  await applyDrizzleEraCatalog(dsn);
  const planeDsn = await createMigratedDatabase(cluster.adminDsn, owned.plane);
  return { dsn, planeDsn };
}

/** Drop both databases, each even if the other's drop fails. A drop with nothing
 * to drop — the failure happened before the create — must not replace the
 * failure that caused the teardown. */
async function dropWithoutMaskingFailure(cluster: TestPostgresCluster, owned: SuiteDatabases): Promise<void> {
  const results = await Promise.allSettled([
    dropCleanDatabase(cluster.adminDsn, owned.legacy),
    dropCleanDatabase(cluster.adminDsn, owned.plane),
  ]);
  const [first] = results.filter((result) => result.status === "rejected");
  if (first !== undefined) throw first.reason;
}
