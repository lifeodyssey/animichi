import { defineConfig } from "vitest/config";
import { PLAIN_NODE_BUDGET_MS } from "./test/test-timeout-budget";

/** Migrator worker HTTP-seam tests (plain vitest; executor and JWKS injected). */
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    // Stated, not inherited (#1594): most of this arm is in-process, so the
    // package-wide budget stays tight enough to catch a real hang. The workerd
    // suites declare their own boot budget; see test/test-timeout-budget.ts.
    testTimeout: PLAIN_NODE_BUDGET_MS,
    coverage: {
      provider: "istanbul",
      include: ["src/**/*.ts"],
      // apply-lock.ts is workerd Durable Object glue, reached only through a real runtime.
      exclude: ["src/apply-lock.ts"],
      reporter: ["text", "lcov"],
      thresholds: { lines: 85, functions: 75, statements: 85, branches: 60 },
    },
  },
});
