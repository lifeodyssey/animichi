/**
 * Lighthouse CI config (S0-v2 C5), driven by the "Web / lighthouse" job in
 * pipeline-web.yml: the job reuses the build artifact and serves it with
 * `wrangler dev` — the same local server the E2E suite already proves works
 * in CI. `pnpm --filter web exec` pins the cwd to apps/web, so this file
 * resolves from the package root.
 *
 * Assertions are intentionally minimal until real-world numbers exist:
 *   • CLS is BLOCKING (error at 0.10, the Google "good" boundary) — layout
 *     stability is a hard requirement for the SSR landing page.
 *   • LCP is report-only (warn at 2500ms) — time-to-content depends on real
 *     edge placement and cold starts, so it warns instead of blocking.
 * Everything else is recorded in the filesystem report, not asserted.
 */
module.exports = {
  ci: {
    collect: {
      url: ["http://localhost:8799/"],
      numberOfRuns: 3,
      startServerCommand: "pnpm --filter web exec wrangler dev --port 8799",
      settings: {
        chromeFlags: "--no-sandbox",
      },
    },
    assert: {
      assertions: {
        "cumulative-layout-shift": ["error", { maxNumericValue: 0.1 }],
        "largest-contentful-paint": ["warn", { maxNumericValue: 2500 }],
      },
    },
    upload: {
      target: "filesystem",
      outputDir: "lighthouse-reports",
    },
  },
};
