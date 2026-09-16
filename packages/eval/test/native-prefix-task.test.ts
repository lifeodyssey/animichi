import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
import type { LaneSnapshot } from '@earendil-works/pi-agent-core';
import { fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai';
import { Case, Dataset } from 'logfire/evals';
import { ExpectedActionPass, modelCallsFrom } from '../src/native/expected-action.ts';
import { loadPrefixCorpus, type LoadedPrefixCorpus, type PrefixCase } from '../src/native/prefix-corpus.ts';
import { prefixTask } from '../src/native/prefix-task.ts';
import { fixtureCatalog } from './native-prefix-catalog.ts';
import { canonicalSelectionCases, caseNamed, phase1cCatalog } from './native-prefix-phase1c.ts';
import { scriptedPorts } from './native-prefix-fixture.ts';

const CASE = 'D3_multi_success_two';

/** A case whose evaluated suffix must be one offered work id, as a model call. */
function declared(entry: PrefixCase, values: readonly string[], tool = 'search_bangumi'): PrefixCase {
  return { ...entry, metadata: { ...entry.metadata, expected_selection: undefined,
    expected_next_action: { tool, arguments: [{ kind: 'enum', argument: 'bangumi_id', values: [...values] }],
      forbidden: { tools: ['respond'], arguments: [] } } } };
}

/** The model calls the tool first, then answers; the catalog serves the recorded work. */
async function evaluate(entries: readonly PrefixCase[], corpus: LoadedPrefixCorpus, bangumiId: string) {
  const catalog = fixtureCatalog([], phase1cCatalog(await canonicalSelectionCases()));
  const dataset = new Dataset<PrefixCase, LaneSnapshot>({ name: 'prefix',
    cases: entries.map((entry) => new Case({ name: entry.name, inputs: entry, metadata: entry.metadata })) });
  dataset.addEvaluator(new ExpectedActionPass());
  return dataset.evaluate((entry) => prefixTask(entry, corpus,
    scriptedPorts([fauxAssistantMessage(fauxToolCall('search_bangumi', { bangumi_id: bangumiId }), { stopReason: 'toolUse' }),
      fauxAssistantMessage('Found it.')], catalog), BACKGROUND_CONTEXT));
}

void test('a model call on a tree fork is judged from its native after_tool witness', async () => {
  const corpus = await loadPrefixCorpus('phase1c_selection_v1');
  const entry = caseNamed(corpus, CASE);
  const report = await evaluate([declared(entry, ['115908'])], corpus, '115908');
  const result = report.cases[0];
  assert.equal(report.failures.length, 0);
  assert.ok(result);
  assert.equal(result.assertions.expected_next_action?.value, true);
  assert.deepEqual(result.metadata, declared(entry, ['115908']).metadata);
  const observed = modelCallsFrom(result.attributes);
  assert.deepEqual(observed.map((call) => call.toolName), ['search_bangumi']);
  assert.deepEqual(observed[0]?.arguments, { bangumi_id: '115908' });
  assert.equal(result.output.transcript.some((item) => item.type === 'message' && item.message.role === 'user'), true);
});

void test('the same tool with a work id the prefix never offered fails the named assertion', async () => {
  const corpus = await loadPrefixCorpus('phase1c_selection_v1');
  const entry = caseNamed(corpus, CASE);
  const report = await evaluate([declared(entry, ['115908'])], corpus, '999001');
  assert.equal(report.cases[0]?.assertions.expected_next_action?.value, false);
});
