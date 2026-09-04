import assert from 'node:assert/strict';
import { test } from 'node:test';

import { errorRateGate } from '../src/gate/bootstrap-gate.ts';
import { oracleEntryNamed, readStatsOracle } from '../src/gate/stats-oracle.ts';

const oracle = readStatsOracle().error_rate_gates;
const clean = oracleEntryNamed(oracle, 'over_ceiling').baseline;

for (const entry of oracle) {
  void test(`${entry.name}: the same failures Python returns`, () => {
    const outcome = errorRateGate(entry.current_errored, entry.current_total, entry.baseline);
    assert.deepEqual(outcome.failures, entry.failures);
  });

  void test(`${entry.name}: the same warnings Python logs`, () => {
    const outcome = errorRateGate(entry.current_errored, entry.current_total, entry.baseline);
    assert.deepEqual(outcome.warnings, entry.warnings);
  });
}

void test('past a fifth of the run the gate blocks whatever the baseline says', () => {
  const outcome = errorRateGate(21, 100, clean);
  assert.deepEqual(outcome.failures, [
    '21/100 cases errored (21%). Check API key and model endpoint.',
  ]);
});

void test('exactly a fifth is still under the ceiling', () => {
  const outcome = errorRateGate(20, 100, null);
  assert.deepEqual(outcome, { failures: [], warnings: [] });
});

void test('one case more crosses it', () => {
  const outcome = errorRateGate(21, 100, null);
  assert.equal(outcome.failures.length, 1);
});

void test('an empty run is a broken run, not a clean one', () => {
  const outcome = errorRateGate(0, 0, clean);
  assert.deepEqual(outcome.failures, [
    '0/0 cases errored (100%). Check API key and model endpoint.',
  ]);
});

void test('a baseline that evaluated nothing is skipped rather than divided by', () => {
  const empty = oracleEntryNamed(oracle, 'empty_baseline');
  const outcome = errorRateGate(1, 100, empty.baseline);
  assert.deepEqual(outcome.warnings, ['Skipping error_rate: zero total cases']);
});

void test('a steady error rate against the real baseline passes', () => {
  const steady = oracleEntryNamed(oracle, 'steady');
  const outcome = errorRateGate(5, 662, steady.baseline);
  assert.deepEqual(outcome, { failures: [], warnings: [] });
});
