import assert from 'node:assert/strict';
import { test } from 'node:test';

import { loadExportedDataset } from '../src/dataset-roundtrip.ts';
import { EVALUATOR_NAMES } from '../src/evaluator-names.ts';
import { AGENT_EVALUATORS } from '../src/evaluators/index.ts';
import type { TranscriptResult } from '../src/evaluators/index.ts';
import { contextFor, oracleCase } from './evaluator-oracle.ts';

const SMALLEST_SET = 'phase1c_selection_v1';
const DROPPED = EVALUATOR_NAMES[0];

void test('an unregistered evaluator name fails loudly and names it', async () => {
  const registered = AGENT_EVALUATORS.filter(
    (evaluator) => evaluator.evaluatorName !== DROPPED,
  );

  await assert.rejects(
    loadExportedDataset(SMALLEST_SET, registered),
    (error: Error) =>
      error.message.includes('Unknown evaluator name') && error.message.includes(DROPPED),
  );
});

void test('every serialized name resolves to its own registered evaluator', async () => {
  const dataset = await loadExportedDataset(SMALLEST_SET);

  assert.deepEqual(
    dataset.evaluators.map((evaluator) => evaluator.getResultName()),
    [...EVALUATOR_NAMES],
  );
});

void test('a registered evaluator is really invoked and scores', async () => {
  const dataset = await loadExportedDataset<TranscriptResult>(SMALLEST_SET);
  const [first] = dataset.evaluators;
  assert.ok(first);

  assert.deepEqual(first.evaluate(contextFor(oracleCase('search_bangumi_exact_chain'))), {
    argument_correctness: 1,
  });
});
