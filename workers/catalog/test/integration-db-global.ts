import {
  applyDrizzleEraCatalog,
  createCleanDatabase,
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
 * WHICH schema owns that database is the catalog's own open item, and until #1628–#1631 move the
 * query layer onto Prisma it is still the Drizzle-era shape: this suite writes
 * `points.latitude` / `longitude` as plain scalars and reads `points.embedding`, both of which the
 * #1626 data plane removed or made generated. So the fixture builds a database of its OWN here —
 * from pristine `template1`, with the frozen fixture `@animichi/test-postgres` keeps for exactly
 * these two lanes (#1625: the shared plane is Prisma-only now, one chain per database). It asks
 * for the cluster alone (#1783): the server, its admin database and the five service roles, with
 * no Prisma-migrated database beside this one that nothing reads. Delete this legacy branch with
 * #1628–#1631.
 *
 * The recipe itself is `@animichi/test-postgres` (#1326), shared with the edge's
 * agent-db arm and with `scripts/local-gates/db-fresh-schema.sh`. What stays this
 * arm's own is the database name and `SPIKE_SETUP_BUDGET`: one container serves
 * the whole suite, so it probes 30 × 1 s.
 */
const LEGACY_DATABASE = "catalog_integration_legacy";

export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const cluster = await startTestPostgresCluster({ budget: SPIKE_SETUP_BUDGET });
  const name = uniqueDatabaseName(LEGACY_DATABASE);
  try {
    const dsn = await createCleanDatabase(cluster.adminDsn, name);
    await applyDrizzleEraCatalog(dsn);
    project.provide("integrationDatabase", { enabled: true, dsn });
  } catch (failure) {
    await dropWithoutMaskingFailure(cluster, name);
    throw failure;
  }
  return () => dropCleanDatabase(cluster.adminDsn, name);
}

/** A drop with nothing to drop — the failure happened before the create — must
 * not replace the failure that caused it. */
async function dropWithoutMaskingFailure(cluster: TestPostgresCluster, name: string): Promise<void> {
  try {
    await dropCleanDatabase(cluster.adminDsn, name);
  } catch {
    // best-effort: the failure being propagated is the one that matters
  }
}
