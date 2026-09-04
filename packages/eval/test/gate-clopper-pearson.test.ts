import assert from 'node:assert/strict';
import { test } from 'node:test';

import { clopperPearsonInterval, proportionComparison } from '../src/gate/clopper-pearson.ts';
import { oracleComparison, readStatsOracle } from '../src/gate/stats-oracle.ts';

const oracle = readStatsOracle();

for (const entry of oracle.clopper_pearson_intervals) {
  void test(`the exact interval for ${String(entry.events)}/${String(entry.total)}`, () => {
    const interval = clopperPearsonInterval(entry.events, entry.total, entry.confidence);
    assert.deepEqual(interval, entry.interval);
  });
}

for (const entry of oracle.proportion_comparisons) {
  void test(`${String(entry.current_events)}/${String(entry.current_total)} against baseline`, () => {
    const result = proportionComparison(
      entry.current_events,
      entry.current_total,
      entry.baseline_events,
      entry.baseline_total,
    );
    assert.deepEqual(result, oracleComparison(entry.comparison));
  });
}

void test('the published 1-of-10 interval is the textbook one', () => {
  const interval = clopperPearsonInterval(1, 10);
  assert.ok(Math.abs(interval.lower - 0.0025286) < 1e-7);
  assert.ok(Math.abs(interval.upper - 0.4450161) < 1e-7);
});

void test('no events means no lower bound, all events means no upper bound', () => {
  assert.equal(clopperPearsonInterval(0, 10).lower, 0);
  assert.equal(clopperPearsonInterval(10, 10).upper, 1);
});

void test('a total of zero has no rate to bound', () => {
  assert.throws(() => clopperPearsonInterval(0, 0), /total must be positive/);
});

void test('events outside the run are refused', () => {
  assert.throws(() => clopperPearsonInterval(11, 10), /between zero and total/);
});

void test('a confidence outside (0, 1) is refused', () => {
  assert.throws(() => clopperPearsonInterval(1, 10, 1), /between zero and one/);
});
