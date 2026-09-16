import type { createCatalogClient } from '@animichi/agent/tools';
import { createModels, fauxProvider, type FauxResponseStep } from '@earendil-works/pi-ai';
import { productionToolNames, promptIdentity } from '../src/native/prefix-cases.ts';
import type { PrefixRecordingPlan, RecordingProvenance } from '../src/native/prefix-record.ts';

/** A fixed streamed-block size: the provider splits blocks with `Math.random()` unless one size is pinned. */
const SCRIPTED_TOKEN_SIZE = 4096;

/** A scripted production harness composition: the provider is the only double. */
export function scriptedPorts(responses: FauxResponseStep[], catalog: ReturnType<typeof createCatalogClient>) {
  const provider = fauxProvider({ api: 'faux', provider: 'faux', models: [{ id: 'faux-model' }],
    tokenSize: { min: SCRIPTED_TOKEN_SIZE, max: SCRIPTED_TOKEN_SIZE } });
  provider.setResponses(responses);
  const models = createModels();
  models.setProvider(provider.provider);
  return { models, model: provider.getModel(), catalog };
}

export function recordingProvenance(): RecordingProvenance {
  return { sdk: '0.85.1', provider: 'faux', model: 'faux-model', prompt: promptIdentity(), tools: PROBE_TOOLS,
    commit: 'tested-commit', catalog: 'deterministic-case-fixture', recorded_at: '2026-09-17T00:00:00.000Z' };
}

/** Two boundaries: one anime ambiguity and one place ambiguity. */
export function recordingPlans(): PrefixRecordingPlan[] {
  return [
    { id: 'anime_case', prompt: 'Find Sound Euphonium', locale: 'en', boundary: 'pending_anime_ambiguity',
      expectedNextAction: { tool: 'none', domain_entry: 'animichi.selection', arguments: [], forbidden: { tools: [], arguments: [] } },
      selection: { candidateIds: ['115908'], expected: { status: 'ok', expect_nonempty: true } } },
    { id: 'place_case', prompt: 'Use Uji', locale: 'ja', boundary: 'pending_place_ambiguity',
      expectedNextAction: { tool: 'none', domain_entry: 'animichi.selection', arguments: [], forbidden: { tools: [], arguments: [] } },
      selection: { candidateIds: ['seed:uji'], expected: { status: 'ok', expect_nonempty: true } } },
  ];
}

export const PROBE_TOOLS = productionToolNames();

/** One valid corpus manifest, in the native `Dataset` file shape. */
export function corpusManifest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: 'probe',
    cases: [{
      name: 'case',
      inputs: {
        prompt: 'Route the selected anime', locale: 'en',
        prefix: { file: 'case.jsonl', session_id: 'case', boundary: 'pending_anime_ambiguity' },
        selection: { candidateIds: ['115908'] },
      },
      metadata: {
        recording: {
          sdk: '0.85.1', provider: 'faux', model: 'faux-model', prompt: promptIdentity(),
          tools: PROBE_TOOLS, commit: 'tested-commit', boundary: 'pending_anime_ambiguity',
          catalog: 'deterministic-case-fixture', recorded_at: '2026-09-17T00:00:00.000Z',
        },
        expected_next_action: { tool: 'none', domain_entry: 'animichi.selection', arguments: [], forbidden: { tools: ['plan_route'], arguments: [] } },
        prefix_state: {
          kind: 'pending_selection', reason: 'anime_ambiguity', clarification_id: 3, entry_id: 'entry-3',
          candidates: [{ id: '115908', title: 'Sound Euphonium' }],
          references: [{ kind: 'search_result', entry_id: 'entry-2', tool: 'search_bangumi' }],
          scalars: [{ namespace: 'animichi.operation.input', key: 'case', value: { locale: 'en' } }],
        },
        expected_selection: { status: 'ok', expect_nonempty: true },
        ...overrides,
      },
    }],
  };
}

/** The single manifest case, typed for round-trip comparisons. */
export function corpusCase(): { inputs: unknown; metadata: unknown } {
  const cases = corpusManifest().cases as { inputs: unknown; metadata: unknown }[];
  const first = cases[0];
  if (first === undefined) throw new Error('corpusManifest has no case');
  return first;
}

/** A recorded-source stub for loader tests that never open the session. */
export function corpusSourceText(): string {
  return JSON.stringify({ v: 4, kind: 'header', id: 'case', storageVersion: 1, createdAt: 0, cwd: 'animichi-eval-prefix' });
}
