import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "*.spec.ts",
  timeout: 30_000,
  retries: 0,
  use: {
    // E2E_BASE_URL targets the legacy Next.js frontend (:3001); apps/web specs use E2E_WEB_BASE_URL instead (see web-404.spec.ts) until the S0.7 cutover.
    baseURL: process.env.E2E_BASE_URL || "http://localhost:3001",
    headless: true,
    screenshot: "only-on-failure",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { browserName: "chromium" },
    },
  ],
});
