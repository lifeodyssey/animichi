import { defineConfig } from "vitest/config";

/**
 * PostGIS spike config — plain Node environment (default forks pool).
 *
 * The spike connects directly to a Docker Postgres+PostGIS via the `pg` driver
 * (which simulates the prod Hyperdrive binding locally) and runs a Drizzle raw
 * `sql` ST_DWithin query. That requires real TCP + node:child_process to manage
 * the container, so it cannot run inside the workerd pool.
 */
export default defineConfig({
  test: {
    include: ["test/**/*.spike.test.ts"],
    environment: "node",
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});
