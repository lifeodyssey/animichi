import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);

/**
 * Locks the shape of `lighthouserc.cjs` — the config the "Web / lighthouse"
 * job feeds `lhci autorun`. The assertions below are the contract with the
 * S0-v2 C5 spec: 3 runs against the locally-served built app, CLS blocking at
 * 0.1, LCP warn-only at 2500ms until real-world numbers exist.
 */
const config = require("../../lighthouserc.cjs") as {
  ci: {
    collect: {
      url: string[];
      numberOfRuns: number;
      startServerCommand: string;
    };
    assert: {
      assertions: Record<string, [string, { maxNumericValue: number }]>;
    };
    upload: {
      target: string;
      outputDir: string;
    };
  };
};

describe("lighthouserc.cjs", () => {
  it("collects 3 runs of the home page from the locally served build", () => {
    expect(config.ci.collect.url).toEqual(["http://localhost:8799/"]);
    expect(config.ci.collect.numberOfRuns).toBe(3);
    expect(config.ci.collect.startServerCommand).toContain("wrangler dev");
  });

  it("blocks on CLS at the 0.1 'good' boundary", () => {
    expect(config.ci.assert.assertions["cumulative-layout-shift"]).toEqual([
      "error",
      { maxNumericValue: 0.1 },
    ]);
  });

  it("only warns on LCP at 2500ms until real-world numbers exist", () => {
    expect(config.ci.assert.assertions["largest-contentful-paint"]).toEqual([
      "warn",
      { maxNumericValue: 2500 },
    ]);
  });

  it("writes the report to the filesystem instead of uploading", () => {
    expect(config.ci.upload).toEqual({ target: "filesystem", outputDir: "lighthouse-reports" });
  });
});
