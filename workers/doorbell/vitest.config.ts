import { defineConfig } from "vitest/config";

/** Doorbell worker HTTP-seam tests (plain vitest; Builds client + JWKS injected). */
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    coverage: {
      provider: "istanbul",
      include: ["src/**/*.ts"],
      reporter: ["text", "lcov"],
      thresholds: { lines: 80, functions: 75, statements: 80, branches: 55 },
    },
  },
});
