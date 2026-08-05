import { defineConfig } from "@playwright/test";

// Staging credentials are written to a host-scoped cookie by global setup so
// browser requests to third-party origins never receive the gate token.
const stagingGateToken = process.env.STAGING_GATE_TOKEN;

export default defineConfig({
  globalSetup: "./global-setup.ts",
  testDir: ".",
  testMatch: "*.spec.ts",
  // D1 card parity: never collect generated artifacts as tests. The visual
  // suite lives under visual/ and only the @visual project collects it.
  testIgnore: ["generated/**"],
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
    ...(stagingGateToken ? { storageState: "./.auth/staging-gate.json" } : {}),
  },
  projects: [
    {
      name: "chromium",
      // The visual suite belongs to its own project; keep the plain suite
      // byte-for-byte as it was.
      testIgnore: ["generated/**", "agent-discovered/**", "visual/**"],
      use: { browserName: "chromium" },
    },
    {
      name: "visual",
      testDir: "visual",
      testMatch: "*.spec.ts",
      timeout: 60_000,
      use: {
        browserName: "chromium",
        // Determinism: kill CSS animations, no service workers, light scheme
        // unless a frame asks for night (see visual/mockup.spec.ts).
        reducedMotion: "reduce",
        serviceWorkers: "block",
        colorScheme: "light",
      },
      // Regression-tier baselines; platform-suffixed so docker (linux) and
      // host (darwin) renders never corrupt each other's accepted state.
      snapshotDir: "./visual/regression-baselines",
      snapshotPathTemplate: "{snapshotDir}/{arg}-{platform}{ext}",
    },
  ],
});
