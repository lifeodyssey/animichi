import { SPIKE_SETUP_BUDGET, startTestPostgres } from "@animichi/test-postgres";
import type { TestProject } from "vitest/node";

/**
 * Suite setup for the hermetic Docker Postgres arm (card 1049): boot the
 * pgvector-extended postgis container, apply the committed Atlas chain to a
 * clean database, and provide its DSN to every spike test file. Any failure in
 * this setup throws — the old silent-skip mode is removed (AC2).
 *
 * The recipe itself is `@animichi/test-postgres` (#1326), shared with the
 * edge's agent-db arm and with `scripts/local-gates/db-fresh-schema.sh`. What
 * stays the spike's own is the database name and `SPIKE_SETUP_BUDGET`: one
 * container serves the whole suite, so it probes 30 × 1 s.
 */
const CLEAN_DATABASE = "catalog_spike";

export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const plane = await startTestPostgres({ database: CLEAN_DATABASE, budget: SPIKE_SETUP_BUDGET });
  project.provide("spikeDatabase", { enabled: true, dsn: plane.dsn });
  return () => plane.stop();
}
