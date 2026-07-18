import { defineConfig } from "vitest/config";

/** Neon-backed spike config — plain Node environment (default forks pool). */
export default defineConfig({
  test: {
    include: ["test/**/*.spike.test.ts"],
    environment: "node",
    globalSetup: ["./test/spike-db-global.ts"],
    testTimeout: 60_000,
    hookTimeout: 120_000,
    // The suite shares one Neon Local branch; each DB file truncates serially.
    fileParallelism: false,
  },
});
