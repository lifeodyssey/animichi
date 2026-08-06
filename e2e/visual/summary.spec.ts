/**
 * Unit tests for the visual task-atom summary contract (S0-v2 F2): the
 * three-state exit code (pass / visual diff / environment-or-invocation), the
 * fail-closed rule (a frame that produced no comparison is never green), and
 * the invocation-error summary (a bogus PAGE must leave a fresh exitCode-2
 * summary, never a stale pass). Pure module, no browser, no network.
 */

import { expect, test } from "@playwright/test";
import {
  assessFrame, buildSummary, invocationErrorSummary, parseFrameReport, parseFrameRuns, parseReachability,
  type FrameReport, type FrameVerdict, type Invocation, type Reachability,
} from "./summary";

const INVOCATION: Invocation = { page: "landing", mode: "day", ratio: 0.01, baseUrl: "http://localhost:3000", runner: "host", frames: [] };
const PASS_REPORT: FrameReport = { ratio: 0.001, threshold: 0.01, pass: true };
const FAIL_REPORT: FrameReport = { ratio: 0.05, threshold: 0.01, pass: false };

function assess(report: FrameReport | null, reach: Reachability, exitCode = 0): FrameVerdict {
  return assessFrame({ frame: "landing-day", exitCode }, report, reach, INVOCATION.baseUrl, INVOCATION.ratio);
}

test.describe("summary contract (F2 task atom)", () => {
  test("parseFrameRuns splits the frame=exit spec", () => {
    expect(parseFrameRuns("landing-day=0 landing-night=1")).toEqual([
      { frame: "landing-day", exitCode: 0 },
      { frame: "landing-night", exitCode: 1 },
    ]);
  });

  test("parseReachability defaults unknown values to app-down (fail-closed)", () => {
    expect(parseReachability("garbage")).toBe("app-down");
    expect(parseReachability("compared")).toBe("compared");
  });

  test("parseFrameReport rejects non-report payloads", () => {
    expect(parseFrameReport({ ratio: "nope", threshold: 1, pass: true })).toBeNull();
    expect(parseFrameReport(42)).toBeNull();
  });

  test("assessFrame passes a frame under threshold", () => {
    const verdict = assess(PASS_REPORT, "compared");
    expect(verdict.status).toBe("pass");
    expect(verdict.reason).toBe("");
  });

  test("assessFrame fails a frame over threshold with its ratio in the reason", () => {
    const verdict = assess(FAIL_REPORT, "compared");
    expect(verdict.status).toBe("fail");
    expect(verdict.reason).toContain("0.0500");
  });

  test("assessFrame fails a frame whose playwright run exited nonzero", () => {
    const verdict = assess(null, "compared", 1);
    expect(verdict.status).toBe("fail");
    expect(verdict.reason).toBe("playwright exited 1");
  });

  test("assessFrame skips a frame with no report when the app is down", () => {
    const verdict = assess(null, "app-down");
    expect(verdict.status).toBe("skipped");
    expect(verdict.reason).toContain("app not reachable");
  });

  test("buildSummary: every frame compared and passed → exitCode 0", () => {
    const summary = buildSummary(INVOCATION, "run-1", [assess(PASS_REPORT, "compared")], null);
    expect(summary.exitCode).toBe(0);
    expect(summary.passed).toBe(1);
    expect(summary.failedFrames).toEqual([]);
  });

  test("buildSummary: a visual diff → exitCode 1 and the frame is listed", () => {
    const summary = buildSummary(INVOCATION, "run-1", [assess(PASS_REPORT, "compared"), assess(FAIL_REPORT, "compared")], null);
    expect(summary.exitCode).toBe(1);
    expect(summary.failedFrames).toEqual(["landing-day"]);
  });

  test("buildSummary: every frame skipped (app down) → exitCode 2, fail-closed", () => {
    const summary = buildSummary(INVOCATION, "run-1", [assess(null, "app-down"), assess(null, "app-down")], null);
    expect(summary.exitCode).toBe(2);
    expect(summary.skipped).toBe(2);
  });

  test("buildSummary: partially unverified frames are fail-closed too", () => {
    const summary = buildSummary(INVOCATION, "run-1", [assess(PASS_REPORT, "compared"), assess(null, "runner-blocked")], null);
    expect(summary.exitCode).toBe(2);
    expect(summary.skippedFrames).toEqual(["landing-day"]);
  });

  test("invocationErrorSummary: no frames → exitCode 2 with the error recorded", () => {
    const summary = invocationErrorSummary(INVOCATION, "run-1", "no visual frame for PAGE=bogus");
    expect(summary.exitCode).toBe(2);
    expect(summary.error).toBe("no visual frame for PAGE=bogus");
    expect(summary.frames).toEqual([]);
  });
});
