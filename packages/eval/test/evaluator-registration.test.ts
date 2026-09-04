import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  UNIMPLEMENTED_EVALUATORS,
  loadExportedDataset,
} from '../src/dataset-roundtrip.ts';
import { EVALUATOR_NAMES } from '../src/evaluator-names.ts';

const SMALLEST_SET = 'phase1c_selection_v1';
const DROPPED = EVALUATOR_NAMES[0];

void test('an unregistered evaluator name fails loudly and names it', async () => {
  const registered = UNIMPLEMENTED_EVALUATORS.filter(
    (evaluator) => evaluator.evaluatorName !== DROPPED,
  );

  await assert.rejects(
    loadExportedDataset(SMALLEST_SET, registered),
    (error: Error) =>
      error.message.includes('Unknown evaluator name') && error.message.includes(DROPPED),
  );
});

void test('every serialized name resolves to its own registered stub', async () => {
  const dataset = await loadExportedDataset(SMALLEST_SET);

  assert.deepEqual(
    dataset.evaluators.map((evaluator) => evaluator.getResultName()),
    [...EVALUATOR_NAMES],
  );
});

void test('a registered stub is really invoked and refuses to score', async () => {
  const dataset = await loadExportedDataset(SMALLEST_SET);
  const first = dataset.evaluators[0];
  assert.ok(first);

  await assert.rejects(
    async () => first.evaluate(unusedContext()),
    { message: `not implemented: ${DROPPED}` },
  );
});

function unusedContext(): never {
  return undefined as never;
}
