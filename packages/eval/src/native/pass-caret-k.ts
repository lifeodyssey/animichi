import { caseGroups } from 'logfire/evals';
import type { EvaluationReport } from 'logfire/evals';
import { requiredAssertionGaps, type AssertionRecord } from './required-assertions.ts';

/**
 * pass^k: did *every* one of the k independently sampled attempts of a case
 * pass? `logfire/evals` supplies the raw material — `repeat: k` runs a case k
 * times under one `source_case_name`, and `caseGroups()` gathers the runs and
 * the task failures per case — but not the verdict, which is product policy.
 *
 * Three outcomes, never two: `pass` means exactly k attempts, no task failure,
 * all k runs satisfying every required assertion and no required evaluator
 * failed; `fail` is a known failure, which always outranks a missing attempt;
 * `incomplete` is only for genuinely missing attempts with no known failure.
 *
 * `attempts = runs + failures`, never `runs` alone: an all-k-throws case is a
 * crash, and reporting a crash as "not measured" is the accounting bug this
 * statistic exists to prevent. The denominator is the planned case list, so a
 * case that never started — no `caseGroup` at all — stays in the report as
 * `incomplete` instead of disappearing. A missing report group is never a pass.
 */

export type PassCaretKVerdict = 'pass' | 'fail' | 'incomplete';

export type PassCaretKReason =
  | 'all-k-passed'
  | 'attempt-overrun'
  | 'missing-attempts'
  | 'required-assertion-missing'
  | 'required-evaluator-failure'
  | 'task-failure';

/** One planned case identity and the assertions its category requires. */
export interface PassCaretKCasePlan {
  readonly name: string;
  readonly requiredAssertions: readonly string[];
}

/** The verdict arithmetic for one case's attempts, before its planned name is attached. */
export interface PassCaretKVerdictResult {
  readonly attempts: number;
  readonly passedRuns: number;
  readonly reason: PassCaretKReason;
  readonly requiredGaps: readonly string[];
  readonly verdict: PassCaretKVerdict;
}

/** The per-case verdict, with the arithmetic that produced it. */
export type PassCaretKCaseResult = PassCaretKVerdictResult & { readonly name: string };

/** The fixed-denominator suite verdict: `planned === passed + failed + incomplete`. */
export interface PassCaretKSummary {
  readonly cases: readonly PassCaretKCaseResult[];
  readonly failed: number;
  readonly incomplete: number;
  readonly k: number;
  readonly passRate: number;
  readonly passed: number;
  readonly planned: number;
}

/** The report's view of one run, matching `ReportCase` structurally. */
export type PassCaretKRun = AssertionRecord;

/** The report's view of one thrown run, matching `ReportCaseFailure` structurally. */
export interface PassCaretKFailure {
  readonly name: string;
}

/** A group of attempts for one planned case, matching `ReportCaseGroup` structurally. */
export interface PassCaretKGroup {
  readonly failures: readonly PassCaretKFailure[];
  readonly name: string;
  readonly runs: readonly PassCaretKRun[];
}

/**
 * The verdict for one case's attempts. Pure: every input is report data.
 */
export function passCaretKVerdict(
  group: PassCaretKGroup | undefined,
  required: readonly string[],
  k: number,
): PassCaretKVerdictResult {
  const runs = group?.runs ?? [];
  const failures = group?.failures ?? [];
  const attempts = runs.length + failures.length;
  const base = { attempts, ...attemptArithmetic(runs, required) };
  const known = knownFailure(runs, failures, required, k);
  if (known !== undefined) return { ...base, verdict: 'fail', reason: known };
  if (attempts < k) return { ...base, verdict: 'incomplete', reason: 'missing-attempts' };
  return { ...base, verdict: 'pass', reason: 'all-k-passed' };
}

/** How many runs satisfied every required assertion, and which names they missed. */
function attemptArithmetic(
  runs: readonly PassCaretKRun[],
  required: readonly string[],
): Pick<PassCaretKVerdictResult, 'passedRuns' | 'requiredGaps'> {
  const gaps = runs.map((run) => requiredAssertionGaps(run, required));
  return {
    passedRuns: gaps.filter((names) => names.length === 0).length,
    requiredGaps: runs.length === 0 ? [...required] : [...new Set(gaps.flat())],
  };
}

/** The reasons a group is already known to have failed, consulted before completeness. */
function knownFailure(
  runs: readonly PassCaretKRun[],
  failures: readonly PassCaretKFailure[],
  required: readonly string[],
  k: number,
): PassCaretKReason | undefined {
  if (failures.length > 0) return 'task-failure';
  if (runs.length + failures.length > k) return 'attempt-overrun';
  return passedAll(runs, required) ? undefined : vetoReason(runs, required);
}

function passedAll(runs: readonly PassCaretKRun[], required: readonly string[]): boolean {
  return runs.every((run) => requiredAssertionGaps(run, required).length === 0);
}

/**
 * The suite summary over the planned identities, with a fixed denominator.
 * Unknown report groups and unplanned identities are refused rather than
 * averaged away.
 */
export function passCaretKSummary<Inputs, Output, Metadata>(
  plan: readonly PassCaretKCasePlan[],
  report: EvaluationReport<Inputs, Output, Metadata>,
  k: number,
): PassCaretKSummary {
  requirePositiveK(k);
  requirePlan(plan);
  const groups = groupsOf(report);
  rejectUnplannedGroups(groups, new Set(plan.map((entry) => entry.name)));
  const cases = summaryCases(plan, groups, k);
  return { k, planned: cases.length, ...tally(cases), cases };
}

/** One verdict per planned identity, in plan order. */
function summaryCases(
  plan: readonly PassCaretKCasePlan[],
  groups: readonly PassCaretKGroup[],
  k: number,
): readonly PassCaretKCaseResult[] {
  const byName = new Map(groups.map((group) => [group.name, group]));
  return plan.map((entry) => ({
    ...passCaretKVerdict(byName.get(entry.name), entry.requiredAssertions, k),
    name: entry.name,
  }));
}

/** One count per outcome; the three always sum to the planned denominator. */
function tally(
  cases: readonly PassCaretKCaseResult[],
): Pick<PassCaretKSummary, 'passed' | 'failed' | 'incomplete' | 'passRate'> {
  const count = (verdict: PassCaretKVerdict): number => cases.filter((entry) => entry.verdict === verdict).length;
  const passed = count('pass');
  return { passed, failed: count('fail'), incomplete: count('incomplete'),
    passRate: cases.length === 0 ? 0 : passed / cases.length };
}

/**
 * The SDK's own grouping, with repeat-1 reports grouped by their case name:
 * `Dataset.evaluate` only sets `source_case_name` when it actually repeats, so
 * a k=1 run has no groups for `caseGroups()` to return.
 */
function groupsOf<Inputs, Output, Metadata>(
  report: EvaluationReport<Inputs, Output, Metadata>,
): readonly PassCaretKGroup[] {
  const grouped = caseGroups(report);
  return grouped ?? singleRunGroups(report);
}

function singleRunGroups<Inputs, Output, Metadata>(
  report: EvaluationReport<Inputs, Output, Metadata>,
): readonly PassCaretKGroup[] {
  const buckets = new Map<string, { runs: PassCaretKRun[]; failures: PassCaretKFailure[] }>();
  for (const run of report.cases) bucketFor(buckets, run.source_case_name ?? run.name).runs.push(run);
  for (const failure of report.failures) {
    bucketFor(buckets, failure.source_case_name ?? failure.name).failures.push(failure);
  }
  return [...buckets].map(([name, bucket]) => ({ name, ...bucket }));
}

function bucketFor(
  buckets: Map<string, { runs: PassCaretKRun[]; failures: PassCaretKFailure[] }>,
  name: string,
): { runs: PassCaretKRun[]; failures: PassCaretKFailure[] } {
  const found = buckets.get(name) ?? { runs: [], failures: [] };
  buckets.set(name, found);
  return found;
}

/** A required evaluator that threw is a veto; a required name that never
 * appeared is a missing assertion. */
function vetoReason(runs: readonly PassCaretKRun[], required: readonly string[]): PassCaretKReason {
  const requiredNames = new Set(required);
  const vetoed = runs.some((run) => run.evaluator_failures.some((failure) => requiredNames.has(failure.name)));
  return vetoed ? 'required-evaluator-failure' : 'required-assertion-missing';
}

function rejectUnplannedGroups(groups: readonly PassCaretKGroup[], planned: ReadonlySet<string>): void {
  const unknown = groups.map((group) => group.name).filter((name) => !planned.has(name));
  if (unknown.length > 0) {
    throw new RangeError(`pass^k report group ${unknown[0] ?? ''} is not in the planned case list`);
  }
}

function requirePlan(plan: readonly PassCaretKCasePlan[]): void {
  if (plan.length === 0) throw new RangeError('pass^k requires at least one planned case');
  const names = plan.map((entry) => entry.name);
  if (new Set(names).size !== names.length) {
    throw new RangeError(`pass^k plan names a case twice: ${names.join(', ')}`);
  }
  for (const entry of plan) requireDeclaredAssertions(entry);
}

function requireDeclaredAssertions(entry: PassCaretKCasePlan): void {
  if (entry.requiredAssertions.length === 0) {
    throw new RangeError(`pass^k plan case ${entry.name} declares no required assertions`);
  }
}

function requirePositiveK(k: number): void {
  if (!Number.isInteger(k) || k < 1) throw new RangeError('pass^k k must be a positive integer');
}
