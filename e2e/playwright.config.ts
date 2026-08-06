import { defineConfig } from "@playwright/test";

// Staging credentials are written to a host-scoped cookie by global setup so
// browser requests to third-party origins never receive the gate token.
const stagingGateToken = process.env.STAGING_GATE_TOKEN;

// The Playwright MCP test server (the agent tool surface) runs as
// `npx playwright run-test-mcp-server`; every other invocation is the plain
// test runner. The "seed" project exists only in the MCP server process so the
// agents can resolve seed.spec.ts while default CLI runs stay at 36 cases in
// 9 files (see generated/README.md).
//
// Worker processes re-require this config file with a different argv, so the
// detection is propagated through the environment: the controller (whose argv
// carries the flag) sets it, and workers inherit process.env at fork time.
const isMcpTestServer = process.argv.slice(2).includes("run-test-mcp-server");
if (isMcpTestServer)
  process.env.E2E_SEED_PROJECT = "1";
const seedProjectEnabled = isMcpTestServer || process.env.E2E_SEED_PROJECT === "1";

export default defineConfig({
  globalSetup: "./global-setup.ts",
  testDir: ".",
  testMatch: "*.spec.ts",
  // Agent-discovered specs live in working dirs until human-gated promotion
  // (see generated/README.md + agent-discovered/README.md); the testMatch glob
  // above swallows subdirectories, so exclude them explicitly. The visual suite
  // lives under visual/ and only the @visual project collects it.
  testIgnore: ["generated/**", "agent-discovered/**"],
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
    // seed.spec.ts is a zero-assertion scaffold the generator agents seed from
    // (see generated/README.md). It must stay at the e2e/ root — the Playwright
    // MCP test server (npx playwright run-test-mcp-server) locates seeds there —
    // but it must never count as a case in the always-run suite: a silent
    // 36 -> 37 drift is exactly what the promotion gate exists to prevent.
    //
    // Playwright runs every project in the config by default, so the seed gets
    // its own project that exists ONLY in the MCP server process. The CLI test
    // runner therefore collects nothing but the 36 real cases in 9 files, while
    // the agents' server resolves the seed project (it sits first, and the MCP
    // server seeds from the first top-level project).
    ...(seedProjectEnabled
      ? [
          {
            name: "seed",
            testMatch: "seed.spec.ts",
            use: { browserName: "chromium" },
          },
        ]
      : []),
    {
      name: "chromium",
      // seed.spec.ts lives here but is not a test; exclude it from the
      // always-run project (the MCP server uses the "seed" project for it).
      // The visual suite belongs to its own project. A project-level
      // testIgnore replaces (does not merge with) the top-level one, so this
      // must carry the full union — dropping any entry here would let that
      // directory back into the default run.
      testIgnore: ["generated/**", "agent-discovered/**", "visual/**", "seed.spec.ts"],
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
