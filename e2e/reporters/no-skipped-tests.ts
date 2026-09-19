import type { Reporter, TestStatus } from "@playwright/test/reporter";

/**
 * The facts this rule reads off a case, declared as what it consults rather
 * than borrowed whole from `TestCase`. Four facts decide the verdict — which
 * project the case belongs to, what its declaration expected, what the run
 * reported, and what to call it — and naming them is what lets
 * `no-skipped-tests.test.ts` drive the guard with exactly those and nothing
 * else. A real `TestCase` satisfies this shape, so the class is still a
 * `Reporter`; the narrowing is interface segregation, not a substitute.
 */
export interface ReportedCase {
  readonly expectedStatus: TestStatus;
  readonly parent: { project(): { readonly name: string } | undefined };
  titlePath(): readonly string[];
}

/** The one fact it reads off a result. */
export interface ReportedResult {
  readonly status: TestStatus;
}

/**
 * A skipped test is not a pass (#1690).
 *
 * `e2e/web-neon-login.spec.ts` was the only end-to-end proof of the login
 * chain, and it shipped as `test.skip(!ready, …)`: every run asserted nothing
 * and exited 0. A summary that distinguishes "ran and passed" from "never ran"
 * is the fix; this reporter is where the run gets the verdict, because
 * Playwright's own exit code counts a skip as success.
 *
 * So the always-run suite fails the lane and names every skipped test. Two
 * projects are exempt, by name and for a stated reason:
 *
 * - `visual` — the opt-in pixel suite (`make visual-check`), which already
 *   reports a per-frame `pass`/`fail`/`skipped` status in
 *   `e2e/visual/report/summary.json` (docs/testing-strategy.md). Its skips are
 *   *reported as not-run* by its own runner, not hidden inside a green test.
 * - `seed` — the MCP server's zero-assertion scaffold, never a collected case.
 *
 * Everything else in the default project set must actually run. A lane that
 * needs credentials or a live origin passes them in; it does not skip.
 */
const EXEMPT_PROJECTS = new Set(["visual", "seed"]);

export default class NoSkippedTestsReporter implements Reporter {
  private readonly skipped: string[] = [];

  onTestEnd(test: ReportedCase, result: ReportedResult): void {
    if (result.status !== "skipped" && test.expectedStatus !== "skipped") return;
    if (EXEMPT_PROJECTS.has(test.parent.project()?.name ?? "")) return;
    this.skipped.push(test.titlePath().join(" › "));
  }

  /** Throwing here is what makes the run exit non-zero: Playwright has no
   * `setExitCode` on the reporter API, and a reporter error fails the run. */
  onEnd(): void {
    if (this.skipped.length === 0) return;
    throw new Error(
      `the suite reported ${String(this.skipped.length)} skipped test(s) — a skipped ` +
        `test is not a pass (#1690). Make it run, or make it fail; the ` +
        `exemptions are the opt-in "visual" project and the MCP "seed" scaffold:\n  ` +
        this.skipped.join("\n  "),
    );
  }
}
