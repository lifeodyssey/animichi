import { defineConfig } from "vitest/config";

/**
 * The plain-Node lane: suites that need a Node host but no database (#1771).
 *
 * Three pools, one question each. `vitest.config.ts` runs what needs the workerd
 * runtime; `vitest.integration.config.ts` runs what needs the Docker Postgres
 * container; this one runs what needs neither — `node:fs`, a child process, a
 * Miniflare R2 bucket, a fake seam. Those suites cannot go in the worker pool
 * (workerd has no filesystem and cannot reach outside `workers/catalog`), and
 * putting them in the container lane made every one of them wait for a database
 * it never opened.
 *
 * No `globalSetup`, and no `pg` alias: `test/integration-db.node.test.ts` asserts
 * how the real driver fails, so it needs the real `pg` — just never a live one.
 *
 * `test/repo-config/integration-lane-selection.test.rb` holds the split: a file
 * the container lane selects must reach for the database.
 */
export default defineConfig({
  test: {
    include: ["test/**/*.node.test.ts"],
    environment: "node",
    // `snapshot-r2-adapter` boots Miniflare twice; its workerd start is the same
    // scheduling cost the worker pool raised its own budget for.
    testTimeout: 20_000,
  },
});
