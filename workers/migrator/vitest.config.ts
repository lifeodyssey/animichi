import { defineConfig } from "vitest/config";

/** Migrator worker HTTP-seam tests (plain vitest; container/JWKS injected). */
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    coverage: {
      provider: "istanbul",
      include: ["src/**/*.ts"],
      // container.ts is the MigrationContainer Durable Object (platform
      // @cloudflare/containers glue — only loadable under workerd, verified by
      // the container image build + staging deploy); ledger.ts is the Neon
      // HTTP adapter (verified against a real Postgres). The spec's testing
      // model is "no tests for Atlas internals or Cloudflare's platform"; the
      // runner/governance logic (runner.ts, migration.ts, policy.ts,
      // create-app.ts) IS covered here.
      exclude: ["src/container.ts", "src/ledger.ts"],
      reporter: ["text", "lcov"],
      thresholds: { lines: 85, functions: 75, statements: 85, branches: 60 },
    },
  },
});