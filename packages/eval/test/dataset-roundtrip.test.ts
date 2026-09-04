import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { EXPORTED_DATASETS } from '../src/dataset-sets.ts';
import { EVALUATOR_NAMES } from '../src/evaluator-names.ts';
import { caseViewPath, loadExportedDataset } from '../src/dataset-roundtrip.ts';

/**
 * The Python-side view of one exported set: written from the dataclasses, not
 * from pydantic-evals' serializer, so it is an independent expectation for
 * what `Dataset.fromFile` must have produced.
 */
interface CaseView {
  evaluators: EvaluatorSpecView[];
  expected_output: unknown;
  inputs: unknown;
  metadata: unknown;
  name: string;
}

interface EvaluatorSpecView {
  arguments: unknown;
  name: string;
}

interface DatasetView {
  cases: CaseView[];
  evaluators: EvaluatorSpecView[];
  name: string;
}

function pythonView(setName: string): DatasetView {
  return JSON.parse(readFileSync(caseViewPath(setName), 'utf8')) as DatasetView;
}

for (const { caseCount, name } of EXPORTED_DATASETS) {
  void test(`${name}: loads through Dataset.fromFile with the exported case count`, async () => {
    const dataset = await loadExportedDataset(name);

    assert.equal(dataset.name, name);
    assert.equal(dataset.cases.length, caseCount);
    assert.equal(pythonView(name).cases.length, caseCount);
  });

  void test(`${name}: dataset-level evaluator specs match the Python specs`, async () => {
    const dataset = await loadExportedDataset(name);

    assert.deepStrictEqual(
      dataset.evaluators.map((evaluator) => evaluator.getSpec()),
      pythonView(name).evaluators,
    );
    assert.deepEqual(
      dataset.evaluators.map((evaluator) => evaluator.getSpec().name),
      [...EVALUATOR_NAMES],
    );
  });

  void test(`${name}: every case deep-equals the Python case`, async () => {
    const dataset = await loadExportedDataset(name);

    const loaded = dataset.cases.map((testCase) => ({
      evaluators: testCase.evaluators.map((evaluator) => evaluator.getSpec()),
      expected_output: testCase.expectedOutput,
      inputs: testCase.inputs,
      metadata: testCase.metadata,
      name: testCase.name,
    }));
    assert.deepStrictEqual(loaded, pythonView(name).cases);
  });
}
