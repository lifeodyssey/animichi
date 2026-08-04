import { defineConfig } from "@playwright/test";

// Staging credentials are written to a host-scoped cookie by global setup so
// browser requests to third-party origins never receive the gate token.
const stagingGateToken = process.env.STAGING_GATE_TOKEN;

export default defineConfig({
  globalSetup: "./global-setup.ts",
  testDir: ".",
  testMatch: "*.spec.ts",
  timeout: 30_000,
  retries: 0,
  use: {
    // Issue #537 retired the legacy Next.js frontend, so `apps/web` is the only
    // browser surface left. Specs still set their own `E2E_WEB_BASE_URL` base
    // (see web-404.spec.ts); this is the shared default they agree with.
    baseURL: process.env.E2E_WEB_BASE_URL || "http://localhost:3000",
    headless: true,
    screenshot: "only-on-failure",
    trace: "on-first-retry",
    ...(stagingGateToken ? { storageState: "e2e/.auth/staging-gate.json" } : {}),
  },
  projects: [
    {
      name: "chromium",
      use: { browserName: "chromium" },
    },
  ],
});
