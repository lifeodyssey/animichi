import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { tmpdir } from 'node:os';
import { basename, dirname } from 'node:path';
import { promisify } from 'node:util';
import { test } from 'node:test';
import { Case, Dataset, MaxDuration } from 'logfire/evals';
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
import type { LaneSnapshot } from '@earendil-works/pi-agent-core';
import { fauxAssistantMessage } from '@earendil-works/pi-ai';
import { inProcessTask } from '../src/native/in-process-task.ts';
import { optionsFor } from './native-task-fixture.ts';
import { ExecutionPass } from '../src/native/execution-evaluator.ts';
import type { NativeTaskInput } from '../src/native/evaluation-types.ts';
import { readRunConfig } from '../src/native/native-run.ts';

void test('native run config records repeat and independent sampling semantics', () => {
  const config = readRunConfig({ EVAL_COMMIT: 'tested-commit', EVAL_REPEAT: '2', EVAL_MAX_CONCURRENCY: '3', EVAL_TRACE_SAMPLE_RATE: '0.5' });
  assert.deepEqual({ repeat: config.repeat, maxConcurrency: config.maxConcurrency, traceSampling: config.traceSampling, smoke: config.smoke },
    { repeat: 2, maxConcurrency: 3, traceSampling: 0.5, smoke: false });
});

void test('an unset report path defaults to a per-dataset file in the OS temporary directory', () => {
  const path = readRunConfig({ EVAL_COMMIT: 'tested-commit' }).reportPath;
  assert.equal(dirname(path), tmpdir());
  assert.equal(basename(path), 'native-agent_eval_heldout_v1.json');
});

void test('an empty trace sampling variable means the default sample rate, not zero', () => {
  assert.equal(readRunConfig({ EVAL_COMMIT: 'tested-commit', EVAL_TRACE_SAMPLE_RATE: '' }).traceSampling, 1);
});

void test('a real run reports both required external bindings when unavailable', async () => {
  const environment: NodeJS.ProcessEnv = { ...process.env, EVAL_COMMIT: 'tested-commit' };
  delete environment.MIMO_API_KEY;
  delete environment.CATALOG_API_URL;
  await assert.rejects(promisify(execFile)(process.execPath,
    ['--import', 'tsx', './scripts/command-task.ts'],
    { cwd: new URL('..', import.meta.url), env: environment }),
    /native eval requires configured bindings: MIMO_API_KEY, CATALOG_API_URL/);
});

void test('the execution assertion rejects a native failed terminal result', async () => {
  const input: NativeTaskInput = { prompt: 'Hello', locale: 'en' };
  const dataset = new Dataset<NativeTaskInput, LaneSnapshot>({ name: 'Execution assertion',
    cases: [new Case({ name: 'failed', inputs: input })], evaluators: [new ExecutionPass()] });
  const report = await dataset.evaluate((taskInput) => inProcessTask(taskInput.prompt,
    (session) => optionsFor(session, [fauxAssistantMessage('', { stopReason: 'error', errorMessage: 'provider unavailable' })])),
    { retryTask: { retries: 0 } });
  assert.equal(report.cases[0]?.assertions.execution_pass?.value, false);
});

const TASK_INPUT: NativeTaskInput = { prompt: 'Hello', locale: 'en' };

function completedAttempt(session: Parameters<typeof optionsFor>[0]) {
  return optionsFor(session, [fauxAssistantMessage('Welcome.')]);
}

void test('MaxDuration fails the attempt afterwards instead of interrupting it', async () => {
  const dataset = new Dataset<NativeTaskInput, LaneSnapshot>({ name: 'Ex-post duration',
    cases: [new Case({ name: 'completed', inputs: TASK_INPUT })],
    evaluators: [new ExecutionPass(), new MaxDuration({ seconds: 0 })] });
  const report = await dataset.evaluate((input) => inProcessTask(input.prompt, completedAttempt),
    { retryTask: { retries: 0 } });
  const attempt = report.cases[0];
  assert.ok(attempt);
  assert.equal(report.failures.length, 0);
  assert.equal(attempt.output.lastResult?.status, 'completed');
  assert.equal(attempt.assertions.execution_pass?.value, true);
  assert.equal(attempt.assertions.MaxDuration?.value, false);
});

void test('a Logfire evaluation signal alone skips unstarted cases without interrupting the attempt', async () => {
  const controller = new AbortController();
  const dataset = new Dataset<NativeTaskInput, LaneSnapshot>({ name: 'Signal only',
    cases: [new Case({ name: 'started', inputs: TASK_INPUT }), new Case({ name: 'unstarted', inputs: TASK_INPUT })],
    evaluators: [new ExecutionPass()] });
  const report = await dataset.evaluate(async (input) => {
    controller.abort(new Error('Experiment cancelled'));
    return await inProcessTask(input.prompt, completedAttempt, BACKGROUND_CONTEXT);
  }, { signal: controller.signal, maxConcurrency: 1, retryTask: { retries: 0 } });
  const attempt = report.cases[0];
  assert.ok(attempt);
  assert.equal(report.failures.length, 0);
  assert.deepEqual(report.cases.map((entry) => entry.name), ['started']);
  assert.equal(attempt.output.lastResult?.status, 'completed');
  assert.equal(attempt.assertions.execution_pass?.value, true);
});
