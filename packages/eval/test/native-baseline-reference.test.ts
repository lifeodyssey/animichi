import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { readRunConfig, runNativeEvaluation, type NativeRunPorts } from '../src/native/native-run.ts';
import { experimentMetadata } from '../src/native/evaluation-report.ts';
import { resolveBaseline } from '../src/native/baseline-reference.ts';
import { Case, Dataset } from 'logfire/evals';
import type { LaneSnapshot } from '@earendil-works/pi-agent-core';
import type { LoadedNativeDataset } from '../src/native/evaluation-dataset.ts';
import type { NativeCaseMetadata, NativeTaskInput } from '../src/native/evaluation-types.ts';
import { model } from './native-model-fixture.ts';

const HELDOUT_BASELINE = 'packages/eval/results/2026-09-07-agent_eval_heldout_v1.json';
const V2_5_BASELINE_MODEL = 'openai:mimo-v2.5@https://api.xiaomimimo.com/v1';
const V2_6_RUN_MODEL = 'opencode-go:mimo-v2.6-flash@https://opencode.ai/zen/go/v1';
const HELDOUT = 'agent_eval_heldout_v1';

void test('an unnamed baseline stays explicitly unnamed instead of looking forgotten', async () => {
  assert.equal(await resolveBaseline(undefined, V2_6_RUN_MODEL, HELDOUT), null);
});

void test('the committed V2.5 heldout artifact names its model and labels the V2.6 comparison a model change', async () => {
  assert.deepEqual(await resolveBaseline(HELDOUT_BASELINE, V2_6_RUN_MODEL, HELDOUT), {
    model: V2_5_BASELINE_MODEL, artifact: HELDOUT_BASELINE, comparison: 'model-change',
  });
});

void test('a schema-2 baseline artifact resolves its model field and labels an identical model same-model', async () => {
  await withScratch(async (directory) => {
    const path = join(directory, 'baseline.json');
    await writeFile(path, JSON.stringify({ schema_version: 2, dataset: HELDOUT, model: V2_5_BASELINE_MODEL }), 'utf8');
    assert.deepEqual(await resolveBaseline(path, V2_5_BASELINE_MODEL, HELDOUT),
      { model: V2_5_BASELINE_MODEL, artifact: path, comparison: 'same-model' });
  });
});

void test('a baseline artifact that does not parse is a failure, not a silent skip', async () => {
  await withScratch(async (directory) => {
    const path = join(directory, 'baseline.json');
    await writeFile(path, '{not json', 'utf8');
    await assert.rejects(resolveBaseline(path, V2_6_RUN_MODEL, HELDOUT), new RegExp(`baseline artifact "${path}" is not valid JSON`));
  });
});

void test('a baseline artifact carrying no model identity is refused', async () => {
  await withScratch(async (directory) => {
    const path = join(directory, 'baseline.json');
    await writeFile(path, JSON.stringify({ schema_version: 2, dataset: HELDOUT, scores: {} }), 'utf8');
    await assert.rejects(resolveBaseline(path, V2_6_RUN_MODEL, HELDOUT),
      new RegExp(`baseline artifact "${path}" names no model \\(expected "model" or "baseline_model"\\)`));
  });
});

void test('a baseline artifact whose JSON is not an object is refused', async () => {
  await withScratch(async (directory) => {
    const path = join(directory, 'baseline.json');
    await writeFile(path, 'null', 'utf8');
    await assert.rejects(resolveBaseline(path, V2_6_RUN_MODEL, HELDOUT), new RegExp(`baseline artifact "${path}" is not a JSON object`));
  });
});

void test('a committed baseline from another dataset is refused before any provider traffic', async () => {
  const other = 'packages/eval/results/2026-09-07-long_context_v1.json';
  await assert.rejects(resolveBaseline(other, V2_6_RUN_MODEL, HELDOUT),
    new RegExp(`baseline artifact "${other}" covers dataset "long_context_v1", not the run's "${HELDOUT}"`));
});

void test('a baseline artifact naming no dataset is refused', async () => {
  await withScratch(async (directory) => {
    const path = join(directory, 'baseline.json');
    await writeFile(path, JSON.stringify({ model: V2_5_BASELINE_MODEL }), 'utf8');
    await assert.rejects(resolveBaseline(path, V2_6_RUN_MODEL, HELDOUT), new RegExp(`baseline artifact "${path}" names no dataset`));
  });
});

void test('a baseline file that is missing names the path it looked for', async () => {
  await withScratch(async (directory) => {
    const path = join(directory, 'absent.json');
    await assert.rejects(resolveBaseline(path, V2_6_RUN_MODEL, HELDOUT), new RegExp(`baseline artifact "${path}" does not exist`));
  });
});

void test('a baseline outside the repository is recorded at its absolute path', async () => {
  await withScratch(async (directory) => {
    const path = join(directory, 'baseline.json');
    await writeFile(path, JSON.stringify({ dataset: HELDOUT, baseline_model: V2_5_BASELINE_MODEL }), 'utf8');
    const resolved = await resolveBaseline(path, V2_6_RUN_MODEL, HELDOUT);
    assert.deepEqual(resolved, { model: V2_5_BASELINE_MODEL, artifact: path, comparison: 'model-change' });
    assert.ok(resolved.artifact.startsWith('/'));
  });
});

void test('an empty baseline variable is refused instead of meaning unnamed', () => {
  assert.throws(() => readRunConfig({ EVAL_COMMIT: 'tested-commit', EVAL_BASELINE: ' ' }), /EVAL_BASELINE must be non-empty/);
});

void test('a named baseline reaches the dry-run result with the labelling resolved', async () => {
  const environment: NodeJS.ProcessEnv = {
    EVAL_COMMIT: 'tested-commit', EVAL_DRY_RUN: '1', EVAL_BASELINE: HELDOUT_BASELINE, EVAL_MODEL: model.id,
  };
  const result = await runNativeEvaluation(readRunConfig(environment), environment, fixturePorts());
  assert.deepEqual(result.baseline, { model: V2_5_BASELINE_MODEL, artifact: HELDOUT_BASELINE, comparison: 'model-change' });
  assert.equal(result.dryRun, true);
});

void test('the experiment metadata names the baseline block or records its absence', () => {
  const named = experimentMetadata(loaded(), provenance(), model,
    { model: V2_5_BASELINE_MODEL, artifact: HELDOUT_BASELINE, comparison: 'model-change' });
  assert.deepEqual(named.baseline, { model: V2_5_BASELINE_MODEL, artifact: HELDOUT_BASELINE, comparison: 'model-change' });
  assert.equal(named.model, 'openai:fixture@https://api.openai.com/v1');
  const unnamed = experimentMetadata(loaded(), provenance(), model, null);
  assert.equal(unnamed.baseline, null);
});

function provenance() {
  return { datasetName: 'agent_eval_heldout_v1', testedCommit: 'tested-commit', repeat: 1, traceSampling: 1, smoke: false };
}

function loaded(): LoadedNativeDataset {
  return {
    dataset: new Dataset<NativeTaskInput, LaneSnapshot, NativeCaseMetadata>({ name: 'Metadata baseline',
      cases: [new Case({ name: 'first', inputs: { prompt: 'p', locale: 'en' },
        metadata: { category: 'end-to-end',
          required_assertions: ['execution_pass', 'tool_correctness_pass', 'trajectory_pass', 'data_keys_pass'] } })] }),
    sourceCaseCount: 33, selectedCaseCount: 1, unsupportedShapes: {},
  };
}

function fixturePorts(): NativeRunPorts {
  return { provider: { getModels: () => [model] }, providerFetch: globalThis.fetch, catalogFetch: globalThis.fetch };
}

async function withScratch(run: (directory: string) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'native-baseline-'));
  try {
    await run(directory);
  } finally {
    await rm(directory, { recursive: true });
  }
}
