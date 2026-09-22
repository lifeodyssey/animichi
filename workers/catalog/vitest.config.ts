import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

/**
 * Worker test config (vitest 4 + vitest-pool-workers 0.16). The pool is applied
 * as a plugin via `cloudflareTest(...)` (the `defineWorkersConfig` /
 * `poolOptions.workers` API was removed in the v3→v4 migration).
 *
 * Covers tests that import the Hono app and exercise it inside the workerd
 * runtime (*.worker.test.ts).
 *
 * The Docker PostGIS integration suite runs under a separate Node config,
 * `vitest.integration.config.ts`, because it needs a real TCP socket + the `pg`
 * driver — a Node-only integration check rather than a Worker-runtime check.
 * The suite runs as the `test:integration` script, not from `npm test`, which
 * is `test:worker` alone.
 */
/** Resolved from `import.meta.url` as a string and `node:path`: this config is
 * type-checked with Cloudflare's DOM-shaped globals, where a `URL` object is not
 * `node:url`'s (the note in `@animichi/test-postgres`'s `prisma-chain.ts`). */
const PG_POOL_STUB = join(dirname(fileURLToPath(import.meta.url)), "test/fakes/pg-pool-stub.ts");

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.toml" },
    }),
  ],
  // `pg` is CommonJS and the pool runs workerd with the CJS→ESM shim disabled,
  // so `@prisma/orm-postgres/serverless` (which imports `pg.Client`) cannot load
  // here. The pool never opens a TCP connection; `test/fakes/pg-pool-stub.ts` is
  // the module that LOADS without one, and it fails loudly if a test reaches
  // for a real driver. The Node integration arm resolves the real `pg`.
  resolve: { alias: { pg: PG_POOL_STUB, "pg-cursor": PG_POOL_STUB } },
  test: {
    include: ["test/**/*.worker.test.ts"],
    // The 41-file pool shares one machine; module imports are slow enough that
    // vitest's 5s default budget blew out (scheduling, not test runtime).
    testTimeout: 20_000,
    coverage: {
      // The workerd pool runs JS instrumented in-runtime, so V8 coverage is not
      // available — istanbul is the supported provider for vitest-pool-workers.
      provider: "istanbul",
      include: ["src/**/*.ts"],
      // Database-only modules (ingest/enrich/publish/media/import/scheduled) are
      // exercised by the *.integration.test.ts Node suite against a real container +
      // the import-integration suite (AC4 atomic switch), not the workerd pool,
      // so they are excluded from this worker-runtime coverage scope.
      exclude: ["src/ingest/**", "src/enrich/**", "src/publish/**", "src/media/**", "src/import/**", "src/scheduled/**"],
      reporter: ["text", "lcov"],
      // Ratcheted to the measured floor (94.69/95.63/92.69/78.37). UP only —
      // never lower these to make a change fit.
      thresholds: {
        lines: 94,
        functions: 95,
        statements: 92,
        branches: 78,
      },
    },
  },
});
