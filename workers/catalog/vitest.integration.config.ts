import { defineConfig } from "vitest/config";

/**
 * Postgres-backed integration config — plain Node environment (default forks pool).
 * The global setup boots the hermetic Docker Postgres+PostGIS arm and clones the
 * container's migrated template into one suite database (see
 * test/integration-db-global.ts, #1769); every *.integration.test.ts runs against
 * it with zero Neon credentials.
 *
 * Every file this selects reaches for that database — a Node suite that does not
 * is a `*.node.test.ts` in `vitest.node.config.ts`, and
 * `test/repo-config/integration-lane-selection.test.rb` refuses the mix (#1771).
 *
 * `test/setup/loopback-only-fetch.ts` lets the global `fetch` reach loopback
 * only: an unstubbed request to any other host is refused, even in a run whose
 * `NODE_USE_ENV_PROXY=1` would hand it to the machine's proxy. The database
 * does not ride `fetch`; `pg` speaks to it over its own socket.
 */
export default defineConfig({
  test: {
    include: ["test/**/*.integration.test.ts"],
    environment: "node",
    globalSetup: ["./test/integration-db-global.ts"],
    setupFiles: ["./test/setup/loopback-only-fetch.ts"],
    testTimeout: 60_000,
    hookTimeout: 120_000,
    // The suite shares one Docker Postgres container; each DB file truncates
    // the catalog FK closure serially.
    fileParallelism: false,
  },
});
