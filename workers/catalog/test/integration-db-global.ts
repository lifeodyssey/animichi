import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  ChainApplyTurn,
  clusterAdminDsn,
  createCleanDatabase,
  dropCleanDatabase,
  SPIKE_SETUP_BUDGET,
  startTestPostgres,
  uniqueDatabaseName,
  type TestPostgres,
} from "@animichi/test-postgres";
import type { TestProject } from "vitest/node";

/**
 * Suite setup for the hermetic Docker Postgres arm (card 1049): boot the
 * pgvector-extended postgis container and provide every integration test file
 * with a migrated database. Any failure in this setup throws — the old
 * silent-skip mode is removed (AC2).
 *
 * WHICH chain owns that database is the catalog's own open item, and until
 * #1628–#1631 move the query layer onto Prisma it is still `migrations/neon`:
 * this suite writes `points.latitude` / `longitude` as plain scalars and reads
 * `points.embedding`, both of which the #1626 data plane removed or made
 * generated. So the fixture builds a database of its OWN here — from pristine
 * `template1`, with the committed Atlas chain — instead of reading the one
 * `startTestPostgres` migrates (#1625: the shared plane is Prisma-only now, and
 * `prisma db migrate` against it is a `MIGRATION.MARKER_MISMATCH`, one chain per
 * database). The plane is still what this suite boots: it owns the container and
 * the five service roles. Delete this legacy branch — and the `atlas` CLI
 * provisioning in `.github/workflows/pr-verification.yml` — with #1628–#1631.
 *
 * The apply holds the cluster turn (#1663) because the Atlas chain's role block
 * is cluster-global and check-then-create; the plane created those roles already,
 * and a second creator that read `pg_roles` in that same window would be the
 * `pg_authid_rolname_index` failure the turn exists to prevent.
 *
 * The recipe itself is `@animichi/test-postgres` (#1326), shared with the edge's
 * agent-db arm and with `scripts/local-gates/db-fresh-schema.sh`. What stays this
 * arm's own is the database name and `SPIKE_SETUP_BUDGET`: one container serves
 * the whole suite, so it probes 30 × 1 s.
 */
const LEGACY_CHAIN = new URL("../../../migrations/neon/", import.meta.url);
const PLANE_DATABASE = "catalog_integration";
const LEGACY_DATABASE = "catalog_integration_legacy";
const OUTPUT_CEILING_BYTES = 10 * 1024 * 1024;

export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const plane = await startTestPostgres({ database: PLANE_DATABASE, budget: SPIKE_SETUP_BUDGET });
  const name = uniqueDatabaseName(LEGACY_DATABASE);
  try {
    const dsn = await createCleanDatabase(plane.dsn, name);
    await new ChainApplyTurn(clusterAdminDsn(plane.dsn)).hold(() => applyLegacyChain(dsn));
    project.provide("integrationDatabase", { enabled: true, dsn });
  } catch (failure) {
    await release(plane, name);
    throw failure;
  }
  return () => release(plane, name);
}

/** Apply the committed `migrations/neon` chain to this suite's own database. */
async function applyLegacyChain(dsn: string): Promise<void> {
  await promisify(execFile)(process.env.ATLAS_BIN ?? "atlas", [
    "migrate", "apply",
    "--dir", LEGACY_CHAIN.href,
    "--url", dsn,
    "--revisions-schema", "public",
  ], {
    env: { ...process.env, ATLAS_NO_UPDATE_NOTIFIER: "1" },
    maxBuffer: OUTPUT_CEILING_BYTES,
  });
}

/** Give both databases back in the order the shared server needs: this suite's
 * own, which is dropped through the plane's database, and then the plane's. A
 * drop with nothing to drop — the failure happened before the create — must not
 * replace the failure that caused it. */
async function release(plane: TestPostgres, name: string): Promise<void> {
  try {
    await dropCleanDatabase(plane.dsn, name);
  } catch {
    // best-effort: the plane's own stop is what must always run
  } finally {
    await plane.stop();
  }
}
