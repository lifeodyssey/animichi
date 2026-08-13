import { describe, expect, it } from "vitest";
import { webCwvConfig } from "../../web-cwv.config";

/**
 * Locks the shape of `web-cwv.config.ts` — the shared thresholds the "Web /
 * lighthouse" job and e2e/web-cwv.spec.ts run against. The assertions below
 * are the contract with the S0-v2 C5 spec: 3 runs against the locally-served
 * built app, CLS blocking at 0.1, LCP warn-only at 2500ms until real-world
 * numbers exist.
 */
describe("web-cwv.config.ts", () => {
  it("collects 3 runs of the home page from the locally served build", () => {
    expect(webCwvConfig.url).toBe("http://localhost:8799/");
    expect(webCwvConfig.numberOfRuns).toBe(3);
    expect(webCwvConfig.startServerCommand).toContain("wrangler dev");
  });

  it("blocks on CLS at the 0.1 'good' boundary", () => {
    expect(webCwvConfig.thresholds.cls.error).toBe(0.1);
  });

  it("only warns on LCP at 2500ms until real-world numbers exist", () => {
    expect(webCwvConfig.thresholds.lcp.warn).toBe(2500);
  });

  it("writes the report to the filesystem instead of uploading", () => {
    expect(webCwvConfig.reportDir).toBe("lighthouse-reports");
  });
});
