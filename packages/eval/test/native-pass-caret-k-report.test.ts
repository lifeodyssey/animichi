import assert from 'node:assert/strict';
import { Case, Dataset, Evaluator, computeAssertionPassRate } from 'logfire/evals';
import type { EvaluatorContext } from 'logfire/evals';
import { test } from 'node:test';

import { passCaretKSummary, type PassCaretKCasePlan } from '../src/native/pass-caret-k.ts';
import {
  PASS_CARET_K_EVALUATOR_NAME,
  PassCaretK,
  recordedPlanCases,
} from '../src/native/pass-caret-k-report.ts';
import { REQUIRED_ASSERTIONS } from '../src/native/required-assertions.ts';

const END_TO_END = [...REQUIRED_ASSERTIONS['end-to-end']];

function planOf(...names: readonly string[]): readonly PassCaretKCasePlan[] {
  return names.map((name) => ({ name, requiredAssertions: END_TO_END }));
}

/** The plan as a run records it in experiment metadata (snake_case, like the
 * case metadata it is derived from). */
function recordedPlan(plan: readonly PassCaretKCasePlan[]): readonly Record<string, unknown>[] {
  return recordedPlanCases(plan);
}

/** A deterministic offline task: `pass` returns normally, `fail` throws. */
function taskOf(input: string): string {
  if (input === 'fail') throw new Error('task failed before any evaluation');
  return input;
}

class RequiredEndToEnd extends Evaluator<string, string, { required_assertions: readonly string[] }> {
  static override evaluatorName = 'required_end_to_end';

  override evaluate({ metadata, output }: EvaluatorContext<string, string, { required_assertions: readonly string[] }>):
  Record<string, boolean> {
    const passed = output === 'pass';
    return Object.fromEntries((metadata?.required_assertions ?? END_TO_END).map((name) => [name, passed]));
  }
}

function datasetOf(): Dataset<string, string, { required_assertions: readonly string[] }> {
  const metadata = { required_assertions: END_TO_END };
  return new Dataset({ name: 'pass-caret-k', cases: [
    new Case({ name: 'A1_ja_001', inputs: 'pass', metadata }),
    new Case({ name: 'A1_ja_002', inputs: 'fail', metadata }),
  ], evaluators: [new RequiredEndToEnd()] });
}

void test('the native SDK report yields pass for the passing case and fail for the throwing one', async () => {
  const report = await datasetOf().evaluate(taskOf, { repeat: 3, retryTask: { retries: 0 } });
  const summary = passCaretKSummary(planOf('A1_ja_001', 'A1_ja_002'), report, 3);
  assert.deepEqual([summary.k, summary.planned, summary.passed, summary.failed, summary.incomplete], [3, 2, 1, 1, 0]);
  assert.deepEqual(summary.cases.map((entry) => [entry.name, entry.verdict, entry.attempts]),
    [['A1_ja_001', 'pass', 3], ['A1_ja_002', 'fail', 3]]);
});

void test('a repeat-1 report still groups its single run per case', async () => {
  const report = await datasetOf().evaluate(taskOf, { repeat: 1, retryTask: { retries: 0 } });
  const summary = passCaretKSummary(planOf('A1_ja_001', 'A1_ja_002'), report, 1);
  assert.deepEqual(summary.cases.map((entry) => [entry.name, entry.verdict]),
    [['A1_ja_001', 'pass'], ['A1_ja_002', 'fail']]);
});

void test('a planned case that never started stays in the denominator as incomplete', async () => {
  const report = await datasetOf().evaluate(taskOf, { repeat: 2, retryTask: { retries: 0 } });
  const summary = passCaretKSummary(planOf('A1_ja_001', 'A1_ja_002', 'A1_ja_003'), report, 2);
  assert.deepEqual([summary.planned, summary.passed, summary.failed, summary.incomplete], [3, 1, 1, 1]);
  assert.deepEqual(summary.cases[2], {
    name: 'A1_ja_003', attempts: 0, passedRuns: 0, requiredGaps: END_TO_END,
    verdict: 'incomplete', reason: 'missing-attempts',
  });
});

void test('the summary refuses an empty plan, a duplicate case and an undeclared assertion list', async () => {
  const report = await datasetOf().evaluate(taskOf, { repeat: 1 });
  assert.throws(() => passCaretKSummary([], report, 1), /at least one planned case/);
  assert.throws(() => passCaretKSummary(planOf('A1_ja_001', 'A1_ja_001'), report, 1), /names a case twice/);
  assert.throws(() => passCaretKSummary([{ name: 'A1_ja_001', requiredAssertions: [] }], report, 1),
    /declares no required assertions/);
  assert.throws(() => passCaretKSummary(planOf('A1_ja_001'), report, 0), /k must be a positive integer/);
});

void test('the summary refuses a report group the plan does not know about', async () => {
  const report = await datasetOf().evaluate(taskOf, { repeat: 1 });
  assert.throws(() => passCaretKSummary(planOf('A1_ja_001'), report, 1),
    /report group A1_ja_002 is not in the planned case list/);
});

void test('the report evaluator turns a repeat run into the pass^k table and verdict block', async () => {
  const plan = planOf('A1_ja_001', 'A1_ja_002');
  const dataset = datasetOf();
  dataset.reportEvaluators.push(new PassCaretK());
  const report = await dataset.evaluate(taskOf, { repeat: 3, retryTask: { retries: 0 },
    metadata: { planned_cases: recordedPlan(plan), repeat: 3 } });
  const table = report.analyses.find((analysis) => analysis.type === 'table');
  assert.ok(table);
  assert.deepEqual(table.rows.map((row) => row.slice(0, 3)),
    [['A1_ja_001', 3, 'pass'], ['A1_ja_002', 3, 'fail']]);
  assert.deepEqual(report.experiment_metadata?.pass_caret_k, {
    k: 3, planned: 2, passed: 1, failed: 1, incomplete: 0, pass_rate: 0.5,
  });
});

void test('an empty assertion set fails pass^k even though the SDK averages it to null', async () => {
  const bare = new Dataset<string, string>({ name: 'no assertions',
    cases: [new Case({ name: 'A1_ja_001', inputs: 'pass' })] });
  const report = await bare.evaluate(taskOf, { repeat: 1 });
  assert.equal(computeAssertionPassRate(report.cases), null);
  const summary = passCaretKSummary(planOf('A1_ja_001'), report, 1);
  assert.deepEqual([summary.passed, summary.failed, summary.cases[0]?.reason],
    [0, 1, 'required-assertion-missing']);
});

void test('a report evaluator refuses to guess a denominator that the run did not record', async () => {
  const dataset = datasetOf();
  dataset.reportEvaluators.push(new PassCaretK());
  const report = await dataset.evaluate(taskOf, { repeat: 1 });
  assert.equal(report.analyses.length, 0);
  assert.deepEqual(report.report_evaluator_failures.map((failure) => failure.name), [PASS_CARET_K_EVALUATOR_NAME]);
  const messages = report.report_evaluator_failures.map((failure) => failure.error_message).join('');
  assert.match(messages, /planned_cases/);
});
