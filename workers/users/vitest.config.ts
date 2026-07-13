import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

/** Worker-runtime tests and coverage for the Users service. */
export default defineConfig({
  plugins: [cloudflareTest({ wrangler: { configPath: "./wrangler.toml" } })],
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
