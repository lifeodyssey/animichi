import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

/**
 * Worker-runtime tests and coverage for the Users service.
 *
 * The Docker PostGIS integration suite runs under a separate Node config,
 * `vitest.integration.config.ts`, because it needs a real TCP socket + the `pg`
 * driver — a Node-only integration check rather than a Worker-runtime check.
 * The suite runs as the `test:integration` script, not from `npm test`, which
 * is `test:worker` alone (#1473).
 */
/** Resolved from `import.meta.url` as a string and `node:path`: this config is
 * type-checked with Cloudflare's DOM-shaped globals, where a `URL` object is not
 * `node:url`'s (the note in `@animichi/test-postgres`'s `prisma-chain.ts`). */
const PG_STUB = join(dirname(fileURLToPath(import.meta.url)), "test/fakes/pg-pool-stub.ts");

export default defineConfig({
  plugins: [cloudflareTest({ wrangler: { configPath: "./wrangler.toml" } })],
  // `pg` is CommonJS and the pool runs workerd with the CJS→ESM shim disabled,
  // so `@prisma/orm-postgres/serverless` (which imports `pg.Client`) cannot load
  // here. The pool never opens a TCP connection; `test/fakes/pg-pool-stub.ts` is
  // the module that LOADS without one, and it fails loudly if a test reaches
  // for a real driver. The Node integration arm resolves the real `pg`.
  resolve: { alias: { pg: PG_STUB, "pg-cursor": PG_STUB } },
  test: {
    include: ["test/**/*.worker.test.ts"],
    coverage: {
      provider: "istanbul",
      include: ["src/**/*.ts"],
      reporter: ["text", "lcov"],
      thresholds: { lines: 60, functions: 60, statements: 60, branches: 50 },
    },
  },
});
