import { defineConfig } from "vitest/config";

/** Load Atlas SQL / atlas.sum as default-export strings (wrangler Text modules). */
function textModules() {
  return {
    name: "text-modules",
    transform(code: string, id: string) {
      const path = id.split("?")[0] ?? id;
      if (!path.endsWith(".sql") && !path.endsWith(".sum")) return undefined;
      return { code: `export default ${JSON.stringify(code)};`, map: null };
    },
  };
}

/** Migrator worker HTTP-seam tests (plain vitest; container/JWKS injected). */
export default defineConfig({
  plugins: [textModules()],
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    coverage: {
      provider: "istanbul",
      include: ["src/**/*.ts"],
      // container.ts / apply-lock.ts are workerd Durable Object glue;
      // ledger.ts is the Neon HTTP adapter (live Postgres); bundled-chain.ts
      // is compile-time SQL imports. Runner/governance + http-apply are covered.
      exclude: ["src/container.ts", "src/ledger.ts", "src/apply-lock.ts", "src/bundled-chain.ts"],
      reporter: ["text", "lcov"],
      thresholds: { lines: 85, functions: 75, statements: 85, branches: 60 },
    },
  },
});
