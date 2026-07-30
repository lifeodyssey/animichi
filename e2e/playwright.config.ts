import { defineConfig } from "@playwright/test";

// Staging sits behind a Cloudflare WAF rule that blocks anything without this
// header (see the staging gate in `infra/index.ts`). Spread conditionally so a
// local run against :3001 sends no header at all — an empty `x-staging-key`
// would not match the rule anyway, and a header that is present but wrong is
// harder to diagnose than one that is absent.
const stagingGateToken = process.env.STAGING_GATE_TOKEN;

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
    ...(stagingGateToken ? { extraHTTPHeaders: { "x-staging-key": stagingGateToken } } : {}),
  },
  projects: [
    {
      name: "chromium",
      use: { browserName: "chromium" },
    },
  ],
});
