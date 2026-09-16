import assert from 'node:assert/strict';
import { Case, Dataset, Evaluator } from 'logfire/evals';
import { test } from 'node:test';

import { reportOnlyJudge } from '../src/native/judge.ts';
import { passCaretKSummary } from '../src/native/pass-caret-k.ts';
import { REQUIRED_ASSERTIONS } from '../src/native/required-assertions.ts';

const REQUIRED = [...REQUIRED_ASSERTIONS['end-to-end']];
const METADATA = { required_assertions: REQUIRED };

class RequiredPass extends Evaluator<string, string, typeof METADATA> {
  static override evaluatorName = 'required_pass';

  override evaluate(): Record<string, boolean> {
    return Object.fromEntries(REQUIRED.map((name) => [name, true]));
  }
}

function datasetOf(judge?: Evaluator<string, string, typeof METADATA>): Dataset<string, string, typeof METADATA> {
  const evaluators = judge === undefined ? [new RequiredPass()] : [new RequiredPass(), judge];
  return new Dataset({ name: 'judge-invariance',
    cases: [new Case({ name: 'A1_ja_001', inputs: 'prompt', metadata: METADATA })], evaluators });
}

function plan(): readonly { name: string; requiredAssertions: readonly string[] }[] {
  return [{ name: 'A1_ja_001', requiredAssertions: REQUIRED }];
}

void test('a report-only judge emits a named score and no assertion', async () => {
  const judge = reportOnlyJudge('task_completion', 'Did the answer complete the request?',
    () => ({ pass: true, score: 1, reason: 'answered' }));
  assert.equal(judge.assertion, false);
  const report = await datasetOf(judge).evaluate((input) => input, { repeat: 1 });
  const first = report.cases[0];
  assert.ok(first);
  assert.deepEqual(Object.keys(first.assertions).sort(), [...REQUIRED].sort());
  assert.deepEqual(Object.keys(first.scores), ['task_completion']);
  assert.deepEqual(first.evaluator_failures, []);
});

void test('a rejected judge verdict is still only a report-only score', async () => {
  const judge = reportOnlyJudge('task_completion', 'Did the answer complete the request?',
    () => ({ pass: false, score: 0.25, reason: 'no route' }));
  const report = await datasetOf(judge).evaluate((input) => input, { repeat: 1 });
  const first = report.cases[0];
  assert.ok(first);
  assert.equal(first.scores.task_completion?.value, 0.25);
  assert.equal('task_completion' in first.assertions, false);
});

void test('judge pass, reject, absence and timeout cannot change pass^k', async () => {
  const pass = reportOnlyJudge('task_completion', 'rubric', () => ({ pass: true, score: 1 }));
  const reject = reportOnlyJudge('task_completion', 'rubric', () => ({ pass: false, score: 0 }));
  const absent = await datasetOf().evaluate((input) => input, { repeat: 1 });
  const accepted = await datasetOf(pass).evaluate((input) => input, { repeat: 1 });
  const rejected = await datasetOf(reject).evaluate((input) => input, { repeat: 1 });
  const verdicts = [absent, accepted, rejected].map((report) => passCaretKSummary(plan(), report, 1));
  assert.deepEqual(verdicts.map((summary) => [summary.passed, summary.failed, summary.incomplete]),
    [[1, 0, 0], [1, 0, 0], [1, 0, 0]]);
});

void test('a throwing judge is an evaluator failure, not a fabricated score or a veto', async () => {
  const judge = reportOnlyJudge('task_completion', 'rubric', () => {
    throw new Error('judge timeout');
  });
  const report = await datasetOf(judge).evaluate((input) => input, { repeat: 1 });
  const first = report.cases[0];
  assert.ok(first);
  assert.deepEqual(first.evaluator_failures.map((failure) => failure.name), ['task_completion']);
  assert.deepEqual(Object.keys(first.scores), []);
  const summary = passCaretKSummary(plan(), report, 1);
  assert.deepEqual([summary.passed, summary.failed], [1, 0]);
});

void test('a judge name can never be a required correctness assertion', () => {
  const declared = Object.values(REQUIRED_ASSERTIONS).flat();
  for (const name of declared) assert.equal(name.endsWith('_score'), false, name);
  assert.equal(declared.includes('task_completion'), false);
  assert.equal(declared.includes('hallucination_check'), false);
});

void test('a judge needs its own name, rubric and supplied callback', () => {
  assert.throws(() => reportOnlyJudge('', 'rubric', () => ({ pass: true, score: 1 })), /name/);
  assert.throws(() => reportOnlyJudge('task_completion', '   ', () => ({ pass: true, score: 1 })), /rubric/);
});
