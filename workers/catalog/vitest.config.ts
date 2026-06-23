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
  },
});
