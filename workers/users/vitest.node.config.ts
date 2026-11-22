import { defineConfig } from "vitest/config";

/**
 * The plain-Node lane: suites that need a Node host but no database.
 *
 * `vitest.config.ts` runs what needs the workerd pool and `vitest.integration.config.ts` what
 * needs the Docker Postgres container; this one runs what needs neither — today the release
 * build of this Worker and a workerd start of what it wrote, which take a child process and a
 * Miniflare the worker pool cannot host. `test` chains it after `test:worker`.
 */
export default defineConfig({
  test: {
    include: ["test/**/*.node.test.ts"],
    environment: "node",
  },
});
