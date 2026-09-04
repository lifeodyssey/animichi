import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  bootstrapGate,
  type BootstrapGateOptions,
  type GateOutcome,
} from '../src/gate/bootstrap-gate.ts';
import {
  oracleEntryNamed,
  readStatsOracle,
  type OracleGateCase,
} from '../src/gate/stats-oracle.ts';

const oracle = readStatsOracle().bootstrap_gates;
const real = oracleEntryNamed(oracle, 'real_baseline_subset');

/** The outcome an oracle entry describes, gated with the settings Python used. */
function makeGateOutcome(entry: OracleGateCase, overrides: BootstrapGateOptions = {}): GateOutcome {
  return bootstrapGate(entry.current_cases, entry.baseline, {
    iterations: entry.iterations,
    strata: entry.strata,
    ...overrides,
  });
}

for (const entry of oracle) {
  void test(`${entry.name}: the same failures Python returns`, () => {
    assert.deepEqual(makeGateOutcome(entry).failures, entry.failures);
  });

  void test(`${entry.name}: the same warnings Python logs`, () => {
    assert.deepEqual(makeGateOutcome(entry).warnings, entry.warnings);
  });
}

void test('a real Python baseline gates a synthetic run and names the regression', () => {
  assert.match(makeGateOutcome(real).failures.join('\n'), /^tool_correctness: mean_delta=/);
});

void test('losing the strata changes the interval the gate reports', () => {
  const outcome = makeGateOutcome(real, { strata: {} });
  assert.notDeepEqual(outcome.failures, real.failures);
});

void test('too few paired cases is skipped, never guessed at', () => {
  const outcome = makeGateOutcome(oracleEntryNamed(oracle, 'few_pairs'));
  assert.deepEqual(outcome, {
    failures: [],
    warnings: ['Skipping metric: only 5 paired cases, need 10'],
  });
});

void test('an indeterminate metric is reported without blocking', () => {
  const outcome = makeGateOutcome(oracleEntryNamed(oracle, 'indeterminate'));
  assert.deepEqual(outcome.failures, []);
  assert.match(outcome.warnings.join('\n'), /^INDETERMINATE metric: /);
});

void test('a lower min_paired lets the skipped metric through', () => {
  const outcome = makeGateOutcome(oracleEntryNamed(oracle, 'few_pairs'), { minPaired: 5 });
  assert.deepEqual(outcome.warnings, []);
});

void test('a baseline the run never touched has nothing to pair', () => {
  const outcome = bootstrapGate({}, real.baseline, { iterations: real.iterations });
  assert.deepEqual(outcome.failures, []);
  assert.equal(outcome.warnings.length, 8);
});
