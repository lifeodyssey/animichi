import assert from 'node:assert/strict';
import { test } from 'node:test';

import { passCaretKVerdict, type PassCaretKGroup } from '../src/native/pass-caret-k.ts';
import { REQUIRED_ASSERTIONS } from '../src/native/required-assertions.ts';

const END_TO_END = [...REQUIRED_ASSERTIONS['end-to-end']];

/** One group of native runs, shaped exactly like the SDK's `ReportCaseGroup`
 * for the three fields the statistic reads. */
function groupOf(
  runs: readonly (readonly boolean[])[],
  failureCount = 0,
  judgeFailures = 0,
): PassCaretKGroup {
  return {
    name: 'A1_ja_001',
    runs: runs.map((values) => ({
      assertions: Object.fromEntries(END_TO_END.map((name, index) => [name, { value: values[index] }])),
      evaluator_failures: Array.from({ length: judgeFailures }, () => ({ name: 'task_completion' })),
    })),
    failures: Array.from({ length: failureCount }, (_, index) => ({ name: `A1_ja_001 [${String(index + 1)}/k]` })),
  };
}

const ALL_TRUE = [true, true, true, true];

void test('k = 1 passes on one passing attempt and fails on one failing attempt', () => {
  assert.equal(passCaretKVerdict(groupOf([ALL_TRUE]), END_TO_END, 1).verdict, 'pass');
  assert.equal(passCaretKVerdict(groupOf([[true, false, true, true]]), END_TO_END, 1).verdict, 'fail');
});

void test('k = n passes only when all k runs pass', () => {
  const passes = passCaretKVerdict(groupOf([ALL_TRUE, ALL_TRUE, ALL_TRUE, ALL_TRUE, ALL_TRUE]), END_TO_END, 5);
  assert.deepEqual([passes.verdict, passes.attempts, passes.passedRuns], ['pass', 5, 5]);
  const mixed = passCaretKVerdict(groupOf([ALL_TRUE, ALL_TRUE, ALL_TRUE, ALL_TRUE, [true, true, false, true]]),
    END_TO_END, 5);
  assert.deepEqual([mixed.verdict, mixed.attempts, mixed.passedRuns], ['fail', 5, 4]);
});

void test('zero passes is a fail, never an incomplete', () => {
  const zero = passCaretKVerdict(groupOf([], 5), END_TO_END, 5);
  assert.deepEqual([zero.verdict, zero.attempts, zero.passedRuns, zero.reason],
    ['fail', 5, 0, 'task-failure']);
  const wrong = passCaretKVerdict(groupOf([[false, false, false, false], [false, false, false, false]]),
    END_TO_END, 5);
  assert.deepEqual([wrong.verdict, wrong.attempts, wrong.passedRuns], ['fail', 2, 0]);
});

void test('an all-k-throws case fails because failures count as attempts', () => {
  const crashed = passCaretKVerdict(groupOf([], 5), END_TO_END, 5);
  assert.equal(crashed.attempts, 5, 'failures must be counted as attempts');
  assert.equal(crashed.verdict, 'fail');
});

void test('missing attempts without any known failure are incomplete and keep the denominator', () => {
  const short = passCaretKVerdict(groupOf([ALL_TRUE, ALL_TRUE, ALL_TRUE]), END_TO_END, 5);
  assert.deepEqual([short.verdict, short.attempts, short.reason], ['incomplete', 3, 'missing-attempts']);
  const unstarted = passCaretKVerdict(undefined, END_TO_END, 5);
  assert.deepEqual([unstarted.verdict, unstarted.attempts], ['incomplete', 0]);
});

void test('a known failure outranks the missing attempts beside it', () => {
  const shortWithFailure = passCaretKVerdict(groupOf([ALL_TRUE, ALL_TRUE], 1), END_TO_END, 5);
  assert.deepEqual([shortWithFailure.verdict, shortWithFailure.attempts, shortWithFailure.reason],
    ['fail', 3, 'task-failure']);
});

void test('a required evaluator failure vetoes a group whose assertions all passed', () => {
  const vetoed: PassCaretKGroup = {
    name: 'A1_ja_001',
    runs: [{ assertions: Object.fromEntries(END_TO_END.map((name) => [name, { value: true }])),
      evaluator_failures: [{ name: 'trajectory_pass' }] }],
    failures: [],
  };
  const verdict = passCaretKVerdict(vetoed, END_TO_END, 1);
  assert.deepEqual([verdict.verdict, verdict.reason], ['fail', 'required-evaluator-failure']);
});

void test('a report-only judge leaves the verdict unchanged', () => {
  const clean = passCaretKVerdict(groupOf([ALL_TRUE]), END_TO_END, 1);
  const judged = passCaretKVerdict(groupOf([ALL_TRUE], 0, 1), END_TO_END, 1);
  assert.deepEqual(judged, clean);
});

void test('more attempts than k is a fail, not an unreported incomplete', () => {
  const overrun = passCaretKVerdict(groupOf([ALL_TRUE, ALL_TRUE, ALL_TRUE]), END_TO_END, 2);
  assert.deepEqual([overrun.verdict, overrun.attempts, overrun.reason], ['fail', 3, 'attempt-overrun']);
});
