/**
 * Unit tests for the visual task-atom summary contract (S0-v2 F2): the
 * three-state exit code (pass / visual diff / environment-or-invocation), the
 * fail-closed rule (a frame that produced no comparison is never green), and
 * the invocation-error summary (a bogus PAGE must leave a fresh exitCode-2
 * summary, never a stale pass). Pure module, no browser, no network.
 */

import { expect, test } from "@playwright/test";
import {
  assessFrame, buildSummary, invocationErrorSummary, parseFrameReport, parseFrameRuns, parseRatio, parseReachability,
  type FrameReport, type FrameVerdict, type Invocation, type Reachability,
} from "./summary";

const INVOCATION: Invocation = { page: "landing", mode: "day", ratio: 0.01, baseUrl: "http://localhost:3000", runner: "host", frames: [] };
const PASS_REPORT: FrameReport = { ratio: 0.001, threshold: 0.01, pass: true };
const FAIL_REPORT: FrameReport = { ratio: 0.05, threshold: 0.01, pass: false };

function assess(frame: string, report: FrameReport | null, reach: Reachability, exitCode = 0): FrameVerdict {
  return assessFrame({ frame, exitCode }, report, { reach, appUrl: INVOCATION.baseUrl, fallbackRatio: INVOCATION.ratio ?? 0.01 });
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

  test("parseRatio accepts finite budgets in (0, 1]", () => {
    expect(parseRatio("0.01")).toBe(0.01);
    expect(parseRatio("0.9999")).toBe(0.9999);
    expect(parseRatio("1")).toBe(1);
    expect(parseRatio("1e-2")).toBe(0.01);
  });

  test("parseRatio rejects malformed or out-of-range budgets (fail-fast, never NaN)", () => {
    expect(parseRatio("oops")).toBeNull();
    expect(parseRatio("")).toBeNull();
    expect(parseRatio("NaN")).toBeNull();
    expect(parseRatio("Infinity")).toBeNull();
    expect(parseRatio("0")).toBeNull();
    expect(parseRatio("-0.5")).toBeNull();
    expect(parseRatio("2")).toBeNull();
  });

  test("parseFrameReport rejects non-report payloads", () => {
    expect(parseFrameReport({ ratio: "nope", threshold: 1, pass: true })).toBeNull();
    expect(parseFrameReport(42)).toBeNull();
  });
});

test.describe("frame assessment", () => {
  test("assessFrame passes a frame under threshold", () => {
    const verdict = assess("landing-day", PASS_REPORT, "compared");
    expect(verdict.status).toBe("pass");
    expect(verdict.reason).toBe("");
  });

  test("assessFrame fails a frame over threshold with its ratio in the reason", () => {
    const verdict = assess("landing-day", FAIL_REPORT, "compared");
    expect(verdict.status).toBe("fail");
    expect(verdict.reason).toContain("0.0500");
  });

  test("assessFrame fails a frame whose playwright run exited nonzero", () => {
    const verdict = assess("landing-day", null, "compared", 1);
    expect(verdict.status).toBe("fail");
    expect(verdict.reason).toBe("playwright exited 1");
  });

  test("assessFrame skips a frame with no report when the app is down", () => {
    const verdict = assess("landing-day", null, "app-down");
    expect(verdict.status).toBe("skipped");
    expect(verdict.reason).toContain("app not reachable");
  });
});

test.describe("summary exit contract", () => {
  test("buildSummary: every frame compared and passed → exitCode 0", () => {
    const summary = buildSummary(INVOCATION, { runId: "run-1", verdicts: [assess("landing-day", PASS_REPORT, "compared")], error: null });
    expect(summary.exitCode).toBe(0);
    expect(summary.passed).toBe(1);
    expect(summary.failedFrames).toEqual([]);
  });

  test("buildSummary: a visual diff → exitCode 1 and the failing frame is listed by its own key", () => {
    const summary = buildSummary(INVOCATION, { runId: "run-1", verdicts: [assess("landing-day", PASS_REPORT, "compared"), assess("landing-night", FAIL_REPORT, "compared")], error: null });
    expect(summary.exitCode).toBe(1);
    expect(summary.failedFrames).toEqual(["landing-night"]);
    expect(summary.frames.map((v) => v.frame)).toEqual(["landing-day", "landing-night"]);
  });

  test("buildSummary: every frame skipped (app down) → exitCode 2, fail-closed", () => {
    const summary = buildSummary(INVOCATION, { runId: "run-1", verdicts: [assess("landing-day", null, "app-down"), assess("landing-night", null, "app-down")], error: null });
    expect(summary.exitCode).toBe(2);
    expect(summary.skipped).toBe(2);
    expect(summary.skippedFrames).toEqual(["landing-day", "landing-night"]);
  });

  test("buildSummary: partially unverified frames are fail-closed too", () => {
    const summary = buildSummary(INVOCATION, { runId: "run-1", verdicts: [assess("landing-day", PASS_REPORT, "compared"), assess("landing-night", null, "runner-blocked")], error: null });
    expect(summary.exitCode).toBe(2);
    expect(summary.skippedFrames).toEqual(["landing-night"]);
  });

  test("invocationErrorSummary: no frames → exitCode 2 with the error recorded", () => {
    const summary = invocationErrorSummary(INVOCATION, "run-1", "no visual frame for PAGE=bogus");
    expect(summary.exitCode).toBe(2);
    expect(summary.error).toBe("no visual frame for PAGE=bogus");
    expect(summary.frames).toEqual([]);
  });

  test("invocationErrorSummary: a malformed RATIO is recorded as ratio null, never silently coerced", () => {
    const malformed = { ...INVOCATION, ratio: null };
    const summary = invocationErrorSummary(malformed, "run-1", "invalid --ratio 'oops' (expected a finite number, 0 < ratio <= 1)");
    expect(summary.exitCode).toBe(2);
    expect(summary.invocation.ratio).toBeNull();
    expect(summary.error).toContain("invalid --ratio");
  });
});
