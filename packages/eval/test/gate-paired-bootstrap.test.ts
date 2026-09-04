import assert from 'node:assert/strict';
import { test } from 'node:test';

import { stratifiedPairedComparison } from '../src/gate/paired-bootstrap.ts';
import { oracleComparison, oracleEntryAt, oracleEntryNamed, readStatsOracle } from '../src/gate/stats-oracle.ts';

const oracle = readStatsOracle().paired_comparisons;
const rare = oracleEntryNamed(oracle, 'rare_stratum_regression');
const overlap = oracleEntryNamed(oracle, 'overlap');
const graded = oracleEntryNamed(oracle, 'graded');

for (const entry of oracle) {
  void test(`${entry.name} matches Python's comparison exactly`, () => {
    const result = stratifiedPairedComparison(entry.pairs, { iterations: entry.iterations });
    assert.deepEqual(result, oracleComparison(entry.comparison));
  });
}

void test('the regression carried by a rare stratum keeps its weight', () => {
  assert.deepEqual(rare.comparison.interval, { lower: 0.1, upper: 0.1 });
});

void test('pooling the same deltas loses it', () => {
  const pooled = rare.pairs.map((pair) => ({ ...pair, stratum: 'pooled' }));
  const result = stratifiedPairedComparison(pooled, { iterations: rare.iterations });
  assert.notDeepEqual(result.interval, rare.comparison.interval);
});

void test('a repeated run is the same run', () => {
  const first = stratifiedPairedComparison(graded.pairs, { iterations: 500 });
  const second = stratifiedPairedComparison(graded.pairs, { iterations: 500 });
  assert.deepEqual(first, second);
});

void test('a different seed moves the interval', () => {
  const shifted = stratifiedPairedComparison(graded.pairs, { iterations: 500, seed: 7 });
  assert.notDeepEqual(shifted.interval, graded.comparison.interval);
});

void test('min_effect decides where pass ends and fail begins', () => {
  const lenient = stratifiedPairedComparison(rare.pairs, { iterations: 500, minEffect: 0.5 });
  assert.equal(lenient.verdict, 'pass');
});

void test('an overlapping interval is indeterminate, not a failure', () => {
  assert.equal(overlap.comparison.verdict, 'indeterminate');
});

void test('zero iterations still draws one sample rather than dividing by nothing', () => {
  const result = stratifiedPairedComparison(oracleEntryAt(oracle, 0).pairs, { iterations: 0 });
  assert.equal(result.interval.lower, 1);
});
