import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildAgentEvaluators } from '../src/evaluators/index.ts';
import { ORACLE, type OracleCase, contextFor } from './evaluator-oracle.ts';

/**
 * The whole score record is compared at once, so a metric Python does *not*
 * emit — `argument_correctness` on a turn with no steps, `nonempty_results` on
 * an untagged case — fails here as a surplus key rather than passing as a zero.
 */
function scoreCase(entry: OracleCase): Record<string, number> {
  const ctx = contextFor(entry);
  const scores: Record<string, number> = {};
  for (const evaluator of buildAgentEvaluators()) {
    Object.assign(scores, evaluator.evaluate(ctx));
  }
  return scores;
}

void test('the oracle covers every one of the eight evaluators', () => {
  const emitted = new Set(ORACLE.cases.flatMap((entry) => Object.keys(entry.scores)));

  assert.deepEqual([...emitted].sort(), [
    'argument_correctness',
    'data_keys_present',
    'locale_match',
    'max_tool_calls',
    'nonempty_results',
    'step_efficiency',
    'tool_correctness',
    'trajectory_match',
  ]);
});

for (const entry of ORACLE.cases) {
  void test(`${entry.caseId}: scores exactly what Python scored`, () => {
    assert.deepEqual(scoreCase(entry), entry.scores);
  });
}
