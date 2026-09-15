import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { readRunConfig, providerCatalog, runNativeEvaluation, type NativeRunPorts } from '../src/native/native-run.ts';

const COMMIT = 'tested-commit';
const OPENCODE_GO_MODEL = 'mimo-v2.5';
const XIAOMI_BASE_URL = 'https://api.xiaomimimo.com/v1';
const OPENCODE_GO_BASE_URL = 'https://opencode.ai/zen/go/v1';

/** A plain OpenAI-shaped completion: this binding's transports are stubbed, the catalog is not. */
function completion(): Response {
  const chunk = { id: 'fixture', object: 'chat.completion.chunk', created: 0, model: OPENCODE_GO_MODEL,
    choices: [{ index: 0, delta: { content: 'Welcome.' }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 } };
  return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, { headers: { 'Content-Type': 'text/event-stream' } });
}

/** The binding's real catalog with its egress stubbed, so selection is proven without a live call. */
function portsFor(requests: Request[]): NativeRunPorts {
  return {
    provider: { getModels: () => providerCatalog('opencode-go') },
    providerFetch: (input) => { requests.push(new Request(input)); return Promise.resolve(completion()); },
    catalogFetch: () => Promise.resolve(Response.json({ rows: [], synced_at: '2026-09-14' })),
  };
}

function environment(reportPath: string, extra: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return { EVAL_COMMIT: COMMIT, EVAL_SMOKE: '1', EVAL_REPORT_PATH: reportPath, ...extra };
}

async function withReportDirectory(run: (reportPath: string) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'native-binding-'));
  try {
    await run(join(directory, 'report.json'));
  } finally {
    await rm(directory, { recursive: true });
  }
}

void test('the provider binding is explicit, defaults to Xiaomi and rejects an unknown name', () => {
  assert.equal(readRunConfig({ EVAL_COMMIT: COMMIT }).provider, 'xiaomi');
  assert.equal(readRunConfig({ EVAL_COMMIT: COMMIT, EVAL_PROVIDER: 'opencode-go' }).provider, 'opencode-go');
  assert.throws(() => readRunConfig({ EVAL_COMMIT: COMMIT, EVAL_PROVIDER: 'opencode' }),
    /EVAL_PROVIDER must be one of: xiaomi, opencode-go/);
});

void test('the OpenCode Go catalog carries mimo-v2.5 and only the APIs this eval can stream', () => {
  const models = providerCatalog('opencode-go');
  assert.deepEqual([...new Set(models.map((model) => model.api))].toSorted(), ['anthropic-messages', 'openai-completions']);
  const mimo = models.find((model) => model.id === OPENCODE_GO_MODEL);
  assert.ok(mimo);
  assert.equal(mimo.provider, 'opencode-go');
  assert.equal(mimo.baseUrl, OPENCODE_GO_BASE_URL);
  assert.equal(providerCatalog('xiaomi').find((model) => model.id === OPENCODE_GO_MODEL)?.baseUrl, XIAOMI_BASE_URL);
});

void test('an OpenCode Go run records the effective provider, model and base URL', async () => {
  await withReportDirectory(async (reportPath) => {
    const requests: Request[] = [];
    const selected = environment(reportPath, { EVAL_PROVIDER: 'opencode-go', OPENCODE_API_KEY: 'fixture-operation-key',
      CATALOG_API_URL: 'https://catalog.example.com' });
    const result = await runNativeEvaluation(readRunConfig(selected), selected, portsFor(requests));
    assert.equal(result.report?.experiment_metadata?.model,
      `opencode-go:${OPENCODE_GO_MODEL}@${OPENCODE_GO_BASE_URL}`);
    assert.equal(requests.length, 3);
    const request = requests[0];
    assert.ok(request);
    assert.equal(new URL(request.url).origin, 'https://opencode.ai');
    assert.equal(request.headers.get('authorization'), 'Bearer fixture-operation-key');
  });
});

void test('the OpenCode Go binding sends one session header per run, as the service requires', async () => {
  await withReportDirectory(async (reportPath) => {
    const requests: Request[] = [];
    const selected = environment(reportPath, { EVAL_PROVIDER: 'opencode-go', OPENCODE_API_KEY: 'fixture-operation-key',
      CATALOG_API_URL: 'https://catalog.example.com' });
    await runNativeEvaluation(readRunConfig(selected), selected, portsFor(requests));
    const sessions = requests.map((request) => request.headers.get('x-opencode-session'));
    assert.equal(requests.length, 3);
    assert.equal(new Set(sessions).size, 1);
    assert.match(String(sessions[0]), /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });
});

void test('the Xiaomi binding sends no session header', async () => {
  await withReportDirectory(async (reportPath) => {
    const requests: Request[] = [];
    const selected = environment(reportPath, { EVAL_PROVIDER: 'xiaomi', MIMO_API_KEY: 'fixture-operation-key',
      CATALOG_API_URL: 'https://catalog.example.com' });
    await runNativeEvaluation(readRunConfig(selected), selected, portsFor(requests));
    assert.equal(requests.length, 3);
    assert.deepEqual(requests.map((request) => request.headers.get('x-opencode-session')), [null, null, null]);
  });
});

void test('a run refuses the missing credential of its own binding and never falls back', async () => {
  await withReportDirectory(async (reportPath) => {
    const opencodeGo = environment(reportPath, { EVAL_PROVIDER: 'opencode-go', MIMO_API_KEY: 'xiaomi-key',
      CATALOG_API_URL: 'https://catalog.example.com' });
    await assert.rejects(runNativeEvaluation(readRunConfig(opencodeGo), opencodeGo, portsFor([])),
      /native eval requires configured bindings: OPENCODE_API_KEY/);
    const xiaomi = environment(reportPath, { OPENCODE_API_KEY: 'opencode-key', CATALOG_API_URL: 'https://catalog.example.com' });
    await assert.rejects(runNativeEvaluation(readRunConfig(xiaomi), xiaomi, portsFor([])),
      /native eval requires configured bindings: MIMO_API_KEY/);
  });
});
