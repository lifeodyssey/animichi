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
 * The PostGIS spike runs under a separate Node config (vitest.spike.config.ts)
 * because it needs a real TCP socket + the `pg` driver — a Node-only
 * integration check rather than a Worker-runtime check. `npm test` runs both.
 */
export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.toml" },
    }),
  ],
  test: {
    include: ["test/**/*.worker.test.ts"],
    coverage: {
      // The workerd pool runs JS instrumented in-runtime, so V8 coverage is not
      // available — istanbul is the supported provider for vitest-pool-workers.
      provider: "istanbul",
      include: ["src/**/*.ts"],
      // Spike-only modules (ingest/enrich/publish/media) are exercised by the
      // *.spike.test.ts Node suite against a real container, not the workerd
      // pool, so they are excluded from this worker-runtime coverage scope.
      exclude: ["src/ingest/**", "src/enrich/**", "src/publish/**", "src/media/**"],
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
