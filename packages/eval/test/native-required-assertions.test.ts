import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

import {
  CASE_CATEGORIES,
  NON_CORRECTNESS_ASSERTIONS,
  REQUIRED_ASSERTIONS,
  caseCategoryOf,
  declareRequiredAssertions,
  requiredAssertionGaps,
  requiredAssertionsOf,
  type CaseCategory,
} from '../src/native/required-assertions.ts';
import { metricNames } from '../src/metric-names.ts';

/** One native `ReportCase` as the report layer sees it: the assertion channel
 * plus the evaluator-failure records, and nothing about how they were produced. */
function runOf(
  assertions: Readonly<Record<string, boolean>>,
  failureNames: readonly string[] = [],
): { assertions: Record<string, { value: boolean }>; evaluator_failures: { name: string }[] } {
  return {
    assertions: Object.fromEntries(Object.entries(assertions).map(([name, value]) => [name, { value }])),
    evaluator_failures: failureNames.map((name) => ({ name })),
  };
}

void test('the four case categories each declare their own named correctness assertions', () => {
  assert.deepEqual([...CASE_CATEGORIES], ['prefix', 'end-to-end', 'safety', 'long-context']);
  for (const category of CASE_CATEGORIES) {
    const required = REQUIRED_ASSERTIONS[category];
    assert.ok(required.length > 0, `${category} must require at least one named assertion`);
    assert.equal(new Set(required).size, required.length, `${category} declares a duplicate assertion`);
  }
});

void test('rig assertions are never correctness requirements', () => {
  const declared = CASE_CATEGORIES.flatMap((category) => [...REQUIRED_ASSERTIONS[category]]);
  for (const rig of NON_CORRECTNESS_ASSERTIONS) {
    assert.equal(declared.includes(rig), false, `${rig} must not be a required correctness assertion`);
  }
});

void test('the end-to-end category is the assertion set the migrated v3 source already carries', () => {
  assert.deepEqual([...REQUIRED_ASSERTIONS['end-to-end']],
    ['execution_pass', 'tool_correctness_pass', 'trajectory_pass', 'data_keys_pass']);
});

void test('every migrated v3 case declares its category and the canonical assertion list', () => {
  const file = fileURLToPath(new URL('../datasets/source/agent_eval_v3.json', import.meta.url));
  const document = JSON.parse(readFileSync(file, 'utf8')) as { cases: { metadata: unknown }[] };
  assert.equal(document.cases.length, 662);
  for (const entry of document.cases) {
    assert.equal(caseCategoryOf(entry.metadata), 'end-to-end');
    assert.deepEqual(requiredAssertionsOf(entry.metadata), [...REQUIRED_ASSERTIONS['end-to-end']]);
  }
});

void test('a case without a declared category is refused rather than assumed', () => {
  assert.throws(() => caseCategoryOf({}), /metadata.category: expected one of prefix, end-to-end, safety, long-context/);
  assert.throws(() => caseCategoryOf({ category: 'happy-path' }), /metadata.category/);
});

void test('a case cannot under-declare or rename its required assertions', () => {
  const full: CaseCategory = 'long-context';
  const declared = [...REQUIRED_ASSERTIONS[full]];
  assert.deepEqual(requiredAssertionsOf({ category: full, required_assertions: declared }), declared);
  assert.throws(() => requiredAssertionsOf({ category: full, required_assertions: [] }),
    /metadata.required_assertions: expected at least one named assertion/);
  assert.throws(() => requiredAssertionsOf({ category: full, required_assertions: declared.slice(1) }),
    /metadata.required_assertions must equal the long-context list/);
  assert.throws(() => requiredAssertionsOf({ category: full, required_assertions: [...declared, 'max_duration'] }),
    /metadata.required_assertions must equal the long-context list/);
  assert.throws(() => requiredAssertionsOf({ category: full }), /metadata.required_assertions/);
});

void test('a missing or false named assertion is a gap', () => {
  const required = [...REQUIRED_ASSERTIONS['long-context']];
  assert.deepEqual(requiredAssertionGaps(runOf({ execution_pass: true, data_keys_pass: true }), required), []);
  assert.deepEqual(requiredAssertionGaps(runOf({ execution_pass: false, data_keys_pass: true }), required),
    ['execution_pass']);
  assert.deepEqual(requiredAssertionGaps(runOf({ execution_pass: true }), required), ['data_keys_pass']);
  assert.deepEqual(requiredAssertionGaps(runOf({}), required), required);
});

void test('an empty assertion set is never a pass', () => {
  assert.deepEqual(requiredAssertionGaps(runOf({}), [...REQUIRED_ASSERTIONS.safety]),
    [...REQUIRED_ASSERTIONS.safety]);
});

void test('a failed required evaluator is a gap even when its assertion name never appeared', () => {
  const required = [...REQUIRED_ASSERTIONS.safety];
  const record = runOf({ execution_pass: true, detection_pass: true }, ['admission_pass']);
  assert.deepEqual(requiredAssertionGaps(record, required), ['admission_pass']);
});

void test('a report-only judge failure is not a required-assertion gap', () => {
  const required = [...REQUIRED_ASSERTIONS['end-to-end']];
  const record = runOf({ execution_pass: true, tool_correctness_pass: true,
    trajectory_pass: true, data_keys_pass: true }, ['task_completion']);
  assert.deepEqual(requiredAssertionGaps(record, required), []);
});

void test('a frozen case receives its dataset category and canonical list', () => {
  assert.deepEqual(declareRequiredAssertions({ path: 'exact_db_api_ok' }, 'safety'), {
    path: 'exact_db_api_ok',
    category: 'safety',
    required_assertions: [...REQUIRED_ASSERTIONS.safety],
  });
  const declared = { category: 'long-context', required_assertions: [...REQUIRED_ASSERTIONS['long-context']] };
  assert.deepEqual(declareRequiredAssertions(declared, 'long-context'), declared);
  assert.throws(() => declareRequiredAssertions(declared, 'safety'), /its dataset declares safety/);
});

void test('correctness assertion names never collide with the numerical profile metrics', () => {
  const metrics = metricNames({ hasNonemptyCases: true, hasParamsRecorded: true, hasMeasuredSteps: true,
    l3Enabled: true });
  const assertions = CASE_CATEGORIES.flatMap((category) => [...REQUIRED_ASSERTIONS[category]]);
  assert.deepEqual(assertions.filter((name) => metrics.includes(name)), []);
});
