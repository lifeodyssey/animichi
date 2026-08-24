/**
 * Core Web Vitals thresholds + controlled harness profile (S0-v2 C5), shared
 * by the affected web CI lane and the Playwright spec
 * e2e/web-cwv.spec.ts, which serves the built app with `wrangler dev` and reads
 * CLS/LCP/INP via the PerformanceObserver API.
 *
 * Release-grade enforcement (issue #1010):
 *   • The harness is a FIXED cold-start mobile profile (AC1): 390x844 viewport,
 *     3x DPR, 4x CPU throttle, ~3G latency/throughput, and a cache policy that
 *     forces a true cold start on every run (no HTTP/disk cache reuse).
 *   • LCP, CLS and INP are all BLOCKING (AC2): each `error` threshold fails the
 *     release gate instead of warning. LCP moved from warn->block here.
 *   • Exactly `numberOfRuns` runs over the `routes` list, aggregated by median
 *     (AC1), so one spiky run cannot fail a release or paper over a regression.
 * Reports land on the filesystem under apps/web/lighthouse-reports.
 */
export const webCwvConfig = {
  url: "http://localhost:8799/",
  numberOfRuns: 3,
  startServerCommand: "pnpm --filter web exec wrangler dev --port 8799",
  /** Explicit route inventory under measurement — a fixed list (AC1), so the
   * profile can never silently shift which pages carry the release gate.
   * `/chat` and not `/`: this is a mobile cold-start profile, and mobile replaces
   * the index with `/chat` on its first client effect under a splash held until
   * chat paints. Desktop stays on the clickable doorway, outside this profile. */
  routes: ["/chat"] as const,
  /** Controlled cold-start mobile profile (AC1). CDP-applied CPU/network
   * throttle + cache policy below; the Playwright `test.use` options set the
   * viewport/DPR/touch. */
  profile: {
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 3,
    /** Chromium CPU throttle multiplier (1 = no throttle). */
    cpuThrottleRate: 4,
    /** ~"Fast 3G" network condition (bytes/sec), CDP bytes-per-second units. */
    network: { latency: 150, downloadThroughput: 1_600_000, uploadThroughput: 750_000 },
    /** cache: "none" forces a true cold start between runs (no reuse). */
    cache: "none",
  },
  thresholds: {
    /** Layout stability block — Google "good" 0.1 boundary. */
    cls: { error: 0.1 },
    /** LCP is now BLOCKING at the Google "good" 2500ms boundary (AC2). */
    lcp: { error: 2500 },
    /** INP block at the Google "good" 200ms boundary (AC3), via a real
     * interaction proxy (see INP_*_SOURCE in the spec). */
    inp: { error: 200 },
  },
  reportDir: "lighthouse-reports",
} as const;
