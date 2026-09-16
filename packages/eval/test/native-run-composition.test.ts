import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { readRunConfig, runNativeEvaluation, evaluationOptions, type NativeRunPorts } from '../src/native/native-run.ts';
import { writeEvaluationReport } from '../src/native/evaluation-report.ts';
import type { NativeTaskInput } from '../src/native/evaluation-types.ts';
import { Dataset, Case } from 'logfire/evals';
import type { LaneSnapshot } from '@earendil-works/pi-agent-core';
import { model } from './native-model-fixture.ts';

/** One catalog point per attempt; the production client reaches it over the configured origin. */
const POINT = { id: 'a', name: 'Station', bangumi_id: '123', screenshot_url: '', latitude: 35, longitude: 139 };
const COST_PER_CALL = 0.75;
const E1_SOURCE_CASES = 33;

function recordOf(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

/** The harness continues a tool turn with a further model call; the wire marks it as `tool`. */
function answeredFromCatalog(body: unknown): boolean {
  const messages = recordOf(body)?.messages;
  if (!Array.isArray(messages)) throw new TypeError('provider request body must carry messages');
  return messages.some((message) => recordOf(message)?.role === 'tool');
}

function toolCall(name: string, args: Record<string, string>): Response {
  const tool = { index: 0, id: name, type: 'function', function: { name, arguments: JSON.stringify(args) } };
  const chunk = { id: 'fixture', object: 'chat.completion.chunk', created: 0, model: 'fixture',
    choices: [{ index: 0, delta: { tool_calls: [tool] }, finish_reason: 'tool_calls' }],
    usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 } };
  return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, { headers: { 'Content-Type': 'text/event-stream' } });
}

function portsFor(providerCalls: Request[], catalogCalls: Request[]): NativeRunPorts {
  return {
    provider: { getModels: () => [model] },
    providerFetch: async (input) => {
      const request = new Request(input);
      providerCalls.push(request);
      const body: unknown = await request.clone().json();
      return answeredFromCatalog(body)
        ? toolCall('respond', { kind: 'search', message: 'The catalog lists one point.' })
        : toolCall('search_bangumi', { bangumi_id: '123' });
    },
    catalogFetch: (input) => {
      catalogCalls.push(new Request(input));
      return Promise.resolve(Response.json({ rows: [POINT], synced_at: '2026-09-10' }));
    },
  };
}

function environmentFor(reportPath: string): NodeJS.ProcessEnv {
  return { MIMO_API_KEY: 'fixture-operation-key', CATALOG_API_URL: 'https://catalog.example.com',
    EVAL_MODEL: model.id, EVAL_COMMIT: 'tested-commit', EVAL_SMOKE: '1', EVAL_REPORT_PATH: reportPath };
}

async function withReportDirectory(run: (path: string) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'native-run-'));
  try {
    await run(join(directory, 'report.json'));
  } finally {
    await rm(directory, { recursive: true });
  }
}

void test('the documented runner composes the real production tools with Dataset.evaluate', async () => {
  await withReportDirectory(async (reportPath) => {
    const providerCalls: Request[] = [];
    const catalogCalls: Request[] = [];
    const config = readRunConfig(environmentFor(reportPath));
    const result = await runNativeEvaluation(config, environmentFor(reportPath),
      portsFor(providerCalls, catalogCalls));
    const report = result.report;
    assert.ok(report);
    assert.equal(providerCalls.length, 6);
    assert.equal(catalogCalls.length, 3);
    const firstCatalogCall = catalogCalls[0];
    assert.ok(firstCatalogCall);
    assert.equal(new URL(firstCatalogCall.url).pathname, '/catalog/points-by-bangumi-id');
    assert.deepEqual(await firstCatalogCall.clone().json(), { bangumi_id: '123' });
    assert.deepEqual(report.cases.map((entry) => entry.output.lastResult?.status),
      ['completed', 'completed', 'completed']);
    assert.deepEqual(report.cases.map((entry) => entry.assertions.execution_pass?.value),
      [true, true, true]);
    assert.equal(report.failures.length, 0);
    assert.equal(result.loaded.sourceCaseCount, E1_SOURCE_CASES);
    assert.equal(result.loaded.selectedCaseCount, 3);
  });
});

void test('the written artifact records the run provenance, native spend and sampled cases', async () => {
  await withReportDirectory(async (reportPath) => {
    const environment = environmentFor(reportPath);
    const result = await runNativeEvaluation(readRunConfig(environment), environment, portsFor([], []));
    const report = result.report;
    assert.ok(report);
    const metadata = report.experiment_metadata;
    assert.ok(metadata);
    const { planned_cases: plan, pass_caret_k: verdict, ...provenance } = metadata;
    assert.deepEqual(provenance, {
      dataset: 'agent_eval_heldout_v1', model: 'openai:fixture@https://api.openai.com/v1',
      commit: 'tested-commit', repeat: 1, sampling: 'iid', trace_sampling: 1, smoke: true,
      source_cases: E1_SOURCE_CASES, selected_cases: 3, unsupported_shapes: {},
      uploader: 'unconfigured', failed_attempt_spend: 'unmeasured',
      actual_spend_usd: 3 * 2 * COST_PER_CALL, actual_spend_status: 'measured',
    });
    assert.deepEqual(plan, ['HO_loc_ja_zhq_001', 'HO_loc_ja_enq_001', 'HO_loc_zh_jaq_001'].map((name) => ({
      name, required_assertions: ['execution_pass', 'tool_correctness_pass', 'trajectory_pass', 'data_keys_pass'],
    })));
    assert.deepEqual(verdict, { k: 1, planned: 3, passed: 0, failed: 3, incomplete: 0, pass_rate: 0 });
    const written: unknown = JSON.parse(await readFile(reportPath, 'utf8'));
    assert.deepEqual(written, JSON.parse(JSON.stringify(report)));
    const rendered = await writeEvaluationReport(report, reportPath);
    assert.match(rendered, /pi\.usage\.status=measured/);
  });
});

/** A run composes the required assertions but registers no domain evaluator yet:
 * every case is missing quality evidence, so pass^k fails rather than reporting
 * a fast-but-wrong attempt as a pass (`execution_pass` alone is not correctness). */
void test('the required assertions fail a case whose quality evaluators are absent', async () => {
  await withReportDirectory(async (reportPath) => {
    const environment = environmentFor(reportPath);
    const result = await runNativeEvaluation(readRunConfig(environment), environment, portsFor([], []));
    const report = result.report;
    assert.ok(report);
    const testTable = report.analyses.filter((analysis) => analysis.type === 'table');
    assert.deepEqual(report.cases.map((entry) => entry.assertions.execution_pass?.value), [true, true, true]);
    assert.deepEqual(testTable.flatMap((table) => table.rows.map((row) => row[4])),
      ['required-assertion-missing', 'required-assertion-missing', 'required-assertion-missing']);
  });
});

void test('repeated and concurrent attempts each complete without sharing session state', async () => {
  await withReportDirectory(async (reportPath) => {
    const environment = { ...environmentFor(reportPath), EVAL_REPEAT: '2', EVAL_MAX_CONCURRENCY: '3' };
    const result = await runNativeEvaluation(readRunConfig(environment), environment, portsFor([], []));
    const report = result.report;
    assert.ok(report);
    assert.equal(report.cases.length, 6);
    assert.deepEqual(report.cases.map((entry) => entry.output.lastResult?.status),
      ['completed', 'completed', 'completed', 'completed', 'completed', 'completed']);
    const metadata = report.experiment_metadata;
    assert.ok(metadata);
    assert.equal(metadata.actual_spend_usd, 6 * 2 * COST_PER_CALL);
    assert.equal(metadata.actual_spend_status, 'measured');
    assert.deepEqual(metadata.pass_caret_k,
      { k: 2, planned: 3, passed: 0, failed: 3, incomplete: 0, pass_rate: 0 });
    assert.equal(report.cases[0]?.attributes['pi.usage.status'], 'measured');
  });
});

void test('a provider outage leaves cost unmeasured rather than priced as zero spend', async () => {
  await withReportDirectory(async (reportPath) => {
    const environment = environmentFor(reportPath);
    const failing: NativeRunPorts = { ...portsFor([], []),
      providerFetch: () => Promise.resolve(new Response('nope', { status: 401 })) };
    const result = await runNativeEvaluation(readRunConfig(environment), environment, failing);
    const report = result.report;
    assert.ok(report);
    assert.equal(report.cases.length, 3);
    assert.equal(report.failures.length, 0);
    assert.deepEqual(report.cases.map((entry) => entry.assertions.execution_pass?.value), [false, false, false]);
    assert.equal(report.cases[0]?.metrics['pi.cost.total'], undefined);
    const metadata = report.experiment_metadata;
    assert.ok(metadata);
    assert.equal(metadata.actual_spend_usd, 0);
    assert.equal(metadata.actual_spend_status, 'unmeasured');
  });
});

void test('the run options never retry a rejected attempt', async () => {
  const options = evaluationOptions(readRunConfig({ EVAL_COMMIT: 'tested-commit' }), {});
  assert.deepEqual(options.retryTask, { retries: 0 });
  let attempts = 0;
  const input: NativeTaskInput = { prompt: 'Hello', locale: 'en' };
  const dataset = new Dataset<NativeTaskInput, LaneSnapshot>({ name: 'No substitution',
    cases: [new Case({ name: 'rejected', inputs: input })] });
  const report = await dataset.evaluate(() => {
    attempts += 1;
    return Promise.reject(new Error('native admission rejected'));
  }, options);
  assert.equal(attempts, 1);
  assert.equal(report.failures.length, 1);
});
