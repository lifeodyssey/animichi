/**
 * Core Web Vitals thresholds (S0-v2 C5), shared by the "Web / lighthouse" job
 * in pipeline-web.yml and the Playwright spec e2e/web-cwv.spec.ts, which
 * serves the built app with `wrangler dev` and reads CLS/LCP via the
 * PerformanceObserver API.
 *
 * Assertions are intentionally minimal until real-world numbers exist:
 *   • CLS is BLOCKING (error at 0.10, the Google "good" boundary) — layout
 *     stability is a hard requirement for the SSR landing page.
 *   • LCP is report-only (warn at 2500ms) — time-to-content depends on real
 *     edge placement and cold starts, so it warns instead of blocking.
 * Reports land on the filesystem under apps/web/lighthouse-reports.
 */
export const webCwvConfig = {
  url: "http://localhost:8799/",
  numberOfRuns: 3,
  startServerCommand: "pnpm --filter web exec wrangler dev --port 8799",
  thresholds: {
    cls: { error: 0.1 },
    lcp: { warn: 2500 },
  },
  reportDir: "lighthouse-reports",
} as const;
