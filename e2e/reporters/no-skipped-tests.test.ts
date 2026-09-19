/**
 * A skipped case is not a pass, as a specification (#1690).
 *
 * `e2e/web-neon-login.spec.ts` was the only end-to-end proof of the Neon Auth
 * login chain, and it shipped as `test.skip(!ready, …)`: every run asserted
 * nothing and exited 0. Playwright's own exit code counts a skip as success, so
 * `reporters/no-skipped-tests.ts` is the only thing that turns that into a red
 * lane — and its exemption list is the only thing standing between a real skip
 * and a green one.
 *
 * Until this file, the guard was pinned by two greps in
 * `test/repo-config/e2e-no-skip.test.rb`: that the config names the reporter,
 * and that the reporter's source text contains `new Set(["visual", "seed"])`.
 * Both pass on a reporter whose logic is dead, inverted or simply never called
 * — which is the defect shape this card is about, one level up. These cases
 * drive the reporter with the facts it reads and assert the verdict it is
 * supposed to reach; `e2e/playwright.config.ts` keeps the other half, that a
 * run registers it at all.
 *
 * test-type: unit (the reporter's own dispatch, driven with the facts it reads;
 * no browser, no clock, no run).
 */
import assert from "node:assert/strict";
import test from "node:test";
import type { TestStatus } from "@playwright/test/reporter";
import NoSkippedTestsReporter, { type ReportedCase, type ReportedResult } from "./no-skipped-tests.ts";

/** The project every collected spec runs in unless it opts out by name. */
const ALWAYS_RUN_PROJECT = "chromium";
/** The opt-in pixel suite (`make visual-check`), exempt for a stated reason. */
const VISUAL_PROJECT = "visual";
/** The MCP test server's zero-assertion scaffold, never a collected case. */
const SEED_PROJECT = "seed";

/** A case as the reporter sees one: the project it belongs to decides which
 *  rule applies. Every reachable skip state reports `"skipped"` in both facts —
 *  a body-level `test.skip()` leaves `expectedStatus` at `"passed"`, a
 *  declaration-level one sets it to `"skipped"` — so the reporter's second
 *  clause is defensive rather than load-bearing, and a case asserting it could
 *  not fail. The cases below pin the clause that does fire. */
function reportedCase(
  projectName: string,
  title: string,
  expectedStatus: TestStatus = "passed",
): ReportedCase {
  return {
    expectedStatus,
    parent: { project: () => ({ name: projectName }) },
    titlePath: () => [projectName, `${title.replaceAll(" ", "-")}.spec.ts`, title],
  };
}

/** The one fact the reporter reads off a result. */
function reportedResult(status: TestStatus): ReportedResult {
  return { status };
}

/** The verdict one run reaches: the refusal it raised, or `undefined` when it
 *  let the run stand. Driving the reporter to its own `onEnd` is the point —
 *  the throw in there is what makes Playwright's exit code non-zero, and a
 *  guard is only evidence if the thing that fails is the thing being tested. */
function verdictOver(
  cases: readonly (readonly [ReportedCase, ReportedResult])[],
): string | undefined {
  const reporter = new NoSkippedTestsReporter();
  for (const [testCase, result] of cases) reporter.onTestEnd(testCase, result);
  try {
    reporter.onEnd();
    return undefined;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

void test("a case that skips at runtime cannot be summarised as a pass", () => {
  const verdict = verdictOver([
    [reportedCase(ALWAYS_RUN_PROJECT, "password sign-in returns to Chat"), reportedResult("skipped")],
  ]);
  assert.ok(verdict !== undefined, "a skipped case must refuse the run, not exit 0");
});

void test("the refusal names the skipped case, so the unrun proof is identifiable", () => {
  const verdict = verdictOver([
    [reportedCase(ALWAYS_RUN_PROJECT, "password sign-in returns to Chat"), reportedResult("skipped")],
  ]);
  assert.match(verdict ?? "", /password sign-in returns to Chat/);
});

void test("every skipped case is named, not only the first", () => {
  const verdict = verdictOver([
    [reportedCase(ALWAYS_RUN_PROJECT, "the first unrun proof"), reportedResult("skipped")],
    [reportedCase(ALWAYS_RUN_PROJECT, "the second unrun proof"), reportedResult("skipped")],
  ]);
  assert.match(verdict ?? "", /the first unrun proof/);
  assert.match(verdict ?? "", /the second unrun proof/);
});

void test("the opt-in visual project's skips stay exempt", () => {
  const verdict = verdictOver([
    [reportedCase(VISUAL_PROJECT, "a frame that has no baseline yet"), reportedResult("skipped")],
  ]);
  assert.equal(verdict, undefined, "the visual suite reports its own not-run frames");
});

void test("the MCP seed scaffold's skips stay exempt", () => {
  const verdict = verdictOver([
    [reportedCase(SEED_PROJECT, "the generator scaffold"), reportedResult("skipped")],
  ]);
  assert.equal(verdict, undefined, "the seed scaffold is never a collected case");
});

void test("the exemption is the project, not the word: it cannot cover another project", () => {
  const verdict = verdictOver([
    [reportedCase(SEED_PROJECT, "an exempt case"), reportedResult("passed")],
    [reportedCase(ALWAYS_RUN_PROJECT, "a skip outside the exemption"), reportedResult("skipped")],
  ]);
  assert.match(verdict ?? "", /a skip outside the exemption/);
  assert.doesNotMatch(verdict ?? "", /an exempt case/);
});

void test("a run where nothing skips reaches no refusal", () => {
  const verdict = verdictOver([
    [reportedCase(ALWAYS_RUN_PROJECT, "a case that ran"), reportedResult("passed")],
    [reportedCase(ALWAYS_RUN_PROJECT, "a case that failed on its own merits"), reportedResult("failed")],
  ]);
  assert.equal(verdict, undefined, "the guard must not refuse a run it has no complaint about");
});
