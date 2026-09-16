import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Case, Dataset, setEvalAttribute } from 'logfire/evals';
import { test } from 'node:test';
import { writeEvaluationReport } from '../src/native/evaluation-report.ts';

void test('the native report artifact retains repeats, metadata and rendered input', async () => {
  const dataset = new Dataset<string, string>({ name: 'Report artifact',
    cases: [new Case({ name: 'first', inputs: 'hello' })] });
  const report = await dataset.evaluate((input) => input, { repeat: 2, retryTask: { retries: 0 },
    metadata: { model: 'faux-model', commit: 'tested-commit', repeat: 2,
      sampling: 'iid', uploader: 'unconfigured', failed_attempt_spend: 'unmeasured' } });
  const directory = await mkdtemp(join(tmpdir(), 'native-eval-report-'));
  try {
    const rendered = await writeEvaluationReport(report, join(directory, 'report.json'));
    const written: unknown = JSON.parse(await readFile(join(directory, 'report.json'), 'utf8'));
    assert.deepEqual(written, report);
    assert.match(rendered, /first/);
    assert.match(rendered, /hello/);
    assert.equal(report.cases.length, 2);
    assert.equal(report.experiment_metadata?.sampling, 'iid');
  } finally {
    await rm(directory, { recursive: true });
  }
});

void test('a case whose seeded state is an attribute is visible in the rendered report', async () => {
  const dataset = new Dataset<string, string>({ name: 'Seeded visibility',
    cases: [new Case({ name: 'seeded-prefix', inputs: 'hello' })] });
  const report = await dataset.evaluate((input) => {
    setEvalAttribute('prefix_seeded', input === 'hello');
    return input;
  }, { retryTask: { retries: 0 } });
  const directory = await mkdtemp(join(tmpdir(), 'native-eval-seeded-'));
  try {
    const rendered = await writeEvaluationReport(report, join(directory, 'report.json'));
    assert.match(rendered, /\nAttributes: 1\nname +attributes\nseeded-prefix +prefix_seeded=true$/u);
  } finally {
    await rm(directory, { recursive: true });
  }
});
