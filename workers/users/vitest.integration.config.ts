import { defineConfig } from "vitest/config";

/**
 * Postgres-backed integration config — plain Node environment, against the
 * repo's disposable container (`@animichi/test-postgres`), never a live Neon.
 *
 * The three `(integration)` acceptance criteria of #1632 live here: the users
 * worker's query layer is proved against a real database rather than a double,
 * because the things they assert — the row shapes a real codec yields, the
 * CHECK constraints the schema enforces, `uuidv7()` assigning the identifier,
 * and the reclaim predicate surviving a real reader — are exactly the facts a
 * fake cannot testify about.
 *
 * Runs as the `test:integration` script, never from `test` (#1473): booting the
 * container on every push that touched this package is what that rule forbids.
 */
export default defineConfig({
  test: {
    include: ["test/**/*.integration.test.ts"],
    environment: "node",
    globalSetup: ["./test/integration-db-global.ts"],
    testTimeout: 60_000,
    hookTimeout: 120_000,
    // The suite shares one container database; each file truncates the
    // saved-route closure serially.
    fileParallelism: false,
  },
});
