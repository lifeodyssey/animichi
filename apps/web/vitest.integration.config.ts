import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globalSetup: ["tests/setup/build-integration-output.ts"],
    include: ["tests/integration/**/*.test.ts"],
    testTimeout: 180_000,
  },
});
