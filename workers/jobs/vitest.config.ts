import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.worker.test.ts"],
    coverage: {
      provider: "istanbul",
      include: ["src/**/*.ts"],
      reporter: ["text", "lcov"],
      thresholds: { lines: 95, functions: 95, statements: 95, branches: 95 },
    },
  },
});
