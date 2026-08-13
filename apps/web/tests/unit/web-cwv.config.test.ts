import { describe, expect, it } from "vitest";
import { webCwvConfig } from "../../web-cwv.config";

/**
 * Locks the shape of `web-cwv.config.ts` — the shared thresholds the "Web /
 * lighthouse" job and e2e/web-cwv.spec.ts run against. The assertions below
 * are the contract with S0-v2 C5 as hardened by issue #1010: a fixed
 * cold-start mobile profile (AC1), LCP/CLS/INP all BLOCKING release gates
 * (AC2/AC3), and a fixed route inventory.
 */
describe("web-cwv.config.ts", () => {
  it("collects 3 cold-start runs of the fixed route inventory from the locally served build", () => {
    expect(webCwvConfig.url).toBe("http://localhost:8799/");
    expect(webCwvConfig.numberOfRuns).toBe(3);
    expect(webCwvConfig.routes).toEqual(["/"]);
    expect(webCwvConfig.startServerCommand).toContain("wrangler dev");
  });

  it("pins the controlled cold-start mobile profile (AC1)", () => {
    const profile = webCwvConfig.profile;
    expect(profile.viewport).toEqual({ width: 390, height: 844 });
    expect(profile.isMobile).toBe(true);
    expect(profile.hasTouch).toBe(true);
    expect(profile.deviceScaleFactor).toBe(3);
    expect(profile.cpuThrottleRate).toBeGreaterThan(1);
    expect(profile.cache).toBe("none");
    // network throttle must be present, not an unthrottled 0 latency
    expect(profile.network.latency).toBeGreaterThan(0);
    expect(profile.network.downloadThroughput).toBeGreaterThan(0);
  });

  it("blocks on CLS at the 0.1 'good' boundary", () => {
    expect(webCwvConfig.thresholds.cls.error).toBe(0.1);
  });

  it("BLOCKS on LCP at the 2500ms 'good' boundary (AC2)", () => {
    expect(webCwvConfig.thresholds.lcp.error).toBe(2500);
  });

  it("BLOCKS on INP at the 200ms 'good' boundary (AC3)", () => {
    expect(webCwvConfig.thresholds.inp.error).toBe(200);
  });

  it("writes the report to the filesystem without uploading lab data", () => {
    expect(webCwvConfig.reportDir).toBe("lighthouse-reports");
  });
});
