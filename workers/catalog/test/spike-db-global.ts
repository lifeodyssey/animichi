import type { TestProject } from "vitest/node";
import { startDataPlane, type DockerDataPlane } from "./spike-db-global/docker";

/**
 * Suite setup for the hermetic Docker Postgres arm (card 1049): boot the
 * pgvector-extended postgis container, apply the committed Atlas chain to a
 * clean database, and provide its DSN to every spike test file. Any failure in
 * this setup throws — the old silent-skip mode is removed (AC2).
 */
export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const plane: DockerDataPlane = await startDataPlane();
  project.provide("spikeDatabase", { enabled: true, dsn: plane.dsn });
  return () => plane.stop();
}
