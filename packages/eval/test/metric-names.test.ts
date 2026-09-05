import assert from 'node:assert/strict';
import { test } from 'node:test';

import { metricNames } from '../src/metric-names.ts';
import { ORACLE } from './evaluator-oracle.ts';

void test('a dataset with nonempty-tagged cases reports all eight metrics', () => {
  assert.deepEqual(
    metricNames({ hasNonemptyCases: true, hasParamsRecorded: true, l3Enabled: false }),
    ORACLE.metricNames.withNonemptyCases,
  );
});

void test('without a nonempty-tagged case that column is not reported at all', () => {
  assert.deepEqual(
    metricNames({ hasNonemptyCases: false, hasParamsRecorded: true, l3Enabled: false }),
    ORACLE.metricNames.withoutNonemptyCases,
  );
});

void test('a run whose reads published no settled params drops that column', () => {
  const dropped = metricNames({ hasNonemptyCases: true, hasParamsRecorded: false, l3Enabled: false });
  assert.deepEqual(
    dropped,
    ORACLE.metricNames.withNonemptyCases.filter((name) => name !== 'argument_correctness'),
  );
});

void test('the L3 judges append after the deterministic metrics', () => {
  assert.deepEqual(metricNames({ hasNonemptyCases: true, hasParamsRecorded: true, l3Enabled: true }), [
    ...ORACLE.metricNames.withNonemptyCases,
    'task_completion',
    'hallucination_check',
  ]);
});
