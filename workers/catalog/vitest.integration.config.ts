import { defineConfig } from "vitest/config";

/**
 * Postgres-backed integration config — plain Node environment (default forks pool).
 * The global setup boots the hermetic Docker Postgres+PostGIS arm (see
 * test/integration-db-global.ts) and applies the committed Atlas chain to a clean
 * database; every *.integration.test.ts runs against it with zero Neon credentials.
 */
export default defineConfig({
  test: {
    include: ["test/**/*.integration.test.ts"],
    environment: "node",
    globalSetup: ["./test/integration-db-global.ts"],
    testTimeout: 60_000,
    hookTimeout: 120_000,
    // The suite shares one Docker Postgres container; each DB file truncates
    // the catalog FK closure serially.
    fileParallelism: false,
  },
});
