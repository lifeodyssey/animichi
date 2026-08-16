import { defineConfig } from "vitest/config";

/** Doorbell worker HTTP-seam tests (plain vitest; Builds client + JWKS injected). */
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    coverage: {
      provider: "istanbul",
      include: ["src/**/*.ts"],
      // live-builds.ts is the Cloudflare Builds HTTP adapter (verified
      // against the real API by the deploy smoke; tests never call it).
      exclude: ["src/live-builds.ts"],
      reporter: ["text", "lcov"],
      thresholds: { lines: 80, functions: 75, statements: 80, branches: 55 },
    },
  },
});
