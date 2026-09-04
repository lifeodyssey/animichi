import assert from 'node:assert/strict';
import { test } from 'node:test';

import { decodeEvaluator, encodeEvaluatorSpec } from 'logfire/evals';
import type { EvaluatorClass } from 'logfire/evals';

import { EVALUATOR_NAMES } from '../src/evaluator-names.ts';
import {
  AGENT_EVALUATORS,
  EVALUATOR_VERSION,
  buildAgentEvaluators,
} from '../src/evaluators/index.ts';
import { ORACLE } from './evaluator-oracle.ts';

const REGISTRY: ReadonlyMap<string, EvaluatorClass> = new Map(
  AGENT_EVALUATORS.map((declared) => [declared.evaluatorName ?? '', declared]),
);
const NO_PRIMARY_ARGS = new Map<string, string>();

void test('the version travels with the Python one', () => {
  assert.equal(EVALUATOR_VERSION, ORACLE.evaluatorVersion);
});

void test('every evaluator serializes as the bare name the exporter writes', () => {
  assert.deepEqual(
    buildAgentEvaluators().map((evaluator) => evaluator.getSpec()),
    EVALUATOR_NAMES.map((name) => ({ arguments: null, name })),
  );
});

void test('a parameterless evaluator encodes to its bare name', () => {
  assert.deepEqual(
    buildAgentEvaluators().map(encodeEvaluatorSpec),
    [...EVALUATOR_NAMES],
  );
});

void test('the encoded name decodes back to the same spec, version intact', () => {
  const decoded = buildAgentEvaluators().map((evaluator) =>
    decodeEvaluator(encodeEvaluatorSpec(evaluator), REGISTRY, NO_PRIMARY_ARGS),
  );

  assert.deepEqual(
    decoded.map((evaluator) => [evaluator.getSpec(), evaluator.evaluatorVersion]),
    EVALUATOR_NAMES.map((name) => [{ arguments: null, name }, EVALUATOR_VERSION]),
  );
});
