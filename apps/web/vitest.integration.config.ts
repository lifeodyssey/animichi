import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    execArgv: ["--no-experimental-webstorage"],
    globalSetup: ["tests/setup/build-integration-output.ts"],
    include: ["tests/integration/**/*.test.ts"],
    testTimeout: 180_000,
  },
});
