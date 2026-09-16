import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fauxAssistantMessage, fauxToolCall, type FauxResponseStep } from '@earendil-works/pi-ai';
import { loadPrefixCorpus } from '../src/native/prefix-corpus.ts';
import { assertCanonicalIdentifiers, assertNoWallClockReadings } from '../src/native/prefix-canonical.ts';
import { assertNoCredentialMaterial, recordBoundaries, writePrefixCorpus } from '../src/native/prefix-record.ts';
import { fixtureCatalog } from './native-prefix-catalog.ts';
import { recordingPlans, recordingProvenance, scriptedPorts } from './native-prefix-fixture.ts';

const UJI = { id: 'seed:uji', label: '宇治(京都府)', name: '宇治', lat: 34.8843, lng: 135.7997, kind: 'city' as const, source: 'seed' as const, effective_radius_m: 10_000 };
const KYOTO = { id: 'seed:kyoto', label: '京都(京都府)', name: '京都', lat: 35.0116, lng: 135.7681, kind: 'city' as const, source: 'seed' as const, effective_radius_m: 20_000 };
const TOKYO = { id: 'seed:tokyo', label: '東京(東京都)', name: '東京', lat: 35.6762, lng: 139.6503, kind: 'city' as const, source: 'seed' as const, effective_radius_m: 20_000 };
const POINT = { id: '115908-point', name: 'Uji bridge', bangumi_id: '115908', screenshot_url: '', latitude: 34.89, longitude: 135.8 };
const KYOTO_POINT = { id: 'seed:kyoto-point', name: '京都御所', bangumi_id: 'seed:kyoto', screenshot_url: '', latitude: 35.02, longitude: 135.76 };

function catalogFixture() {
  return {
    resolve: { 'Sound Euphonium': { outcome: 'needs_disambiguation' as const, reason: 'anime_ambiguity' as const, candidates: [
      { bangumi_id: '115908', title: 'Sound Euphonium' }, { bangumi_id: '11291', title: 'Haruhi Suzumiya' }] } },
    geocode: { [KYOTO.label]: { candidates: [KYOTO] }, 宇治: { candidates: [UJI, TOKYO] } },
    pointsById: { [POINT.id]: POINT, [KYOTO_POINT.id]: KYOTO_POINT },
    works: { '115908': [POINT.id] }, nearby: { '35.0116,135.7681': [KYOTO_POINT.id] },
  };
}

function animeAndPlaceScript(): FauxResponseStep[] {
  return [
    fauxAssistantMessage(fauxToolCall('search_bangumi', { bangumi_id: '115908' }), { stopReason: 'toolUse' }),
    fauxAssistantMessage(fauxToolCall('resolve_anime', { title: 'Sound Euphonium' }), { stopReason: 'toolUse' }),
    fauxAssistantMessage('Which work did you mean?'),
    fauxAssistantMessage(fauxToolCall('search_nearby', { location: KYOTO.label }), { stopReason: 'toolUse' }),
    fauxAssistantMessage(fauxToolCall('search_nearby', { location: '宇治' }), { stopReason: 'toolUse' }),
    fauxAssistantMessage('Which place did you mean?'),
  ];
}

async function recordProbe() {
  const calls: Request[] = [];
  return recordBoundaries(recordingPlans(), scriptedPorts(animeAndPlaceScript(), fixtureCatalog(calls, catalogFixture())), recordingProvenance());
}

async function withRoot(run: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'prefix-write-'));
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

void test('a recorded boundary freezes the pending selection, its reference, its scalar and a portable header', async () => {
  const recorded = await recordProbe();
  assert.deepEqual(recorded.map((entry) => entry.name), ['anime_case', 'place_case']);
  const [anime, place] = recorded;
  assert.ok(anime && place);
  assert.deepEqual(anime.metadata.prefix_state.candidates,
    [{ id: '115908', title: 'Sound Euphonium' }, { id: '11291', title: 'Haruhi Suzumiya' }]);
  assert.equal(anime.metadata.prefix_state.reason, 'anime_ambiguity');
  assert.equal(anime.metadata.prefix_state.references[0]?.tool, 'search_bangumi');
  assert.deepEqual(place.metadata.prefix_state.candidates[0],
    { id: 'seed:uji', title: '宇治(京都府)', lat: 34.8843, lng: 135.7997, effective_radius_m: 10_000 });
  assert.equal(place.metadata.prefix_state.reason, 'place_ambiguity');
  assert.equal(place.metadata.prefix_state.references[0]?.tool, 'search_nearby');
  assert.deepEqual(anime.metadata.prefix_state.scalars,
    [{ namespace: 'animichi.operation.input', key: 'anime_case', value: { locale: 'en' } }]);
  const header = JSON.parse(anime.sourceText.split('\n')[0] ?? '') as Record<string, unknown>;
  assert.deepEqual([header.v, header.kind, header.id, header.cwd], [4, 'header', 'anime_case', 'animichi-eval-prefix']);
  assert.equal(anime.sourceText.includes(tmpdir()), false);
});

void test('a written corpus reloads through the official reader without a converter', async () => {
  await withRoot(async (root) => {
    await writePrefixCorpus(root, 'phase1c_selection_v1', await recordProbe());
    const corpus = await loadPrefixCorpus('phase1c_selection_v1', root);
    const first = corpus.cases[0];
    assert.deepEqual(corpus.cases.map((entry) => entry.name), ['anime_case', 'place_case']);
    assert.ok(first);
    assert.deepEqual(first.metadata.prefix_state.candidates[0], { id: '115908', title: 'Sound Euphonium' });
    assert.deepEqual(first.inputs.selection?.candidateIds, ['115908']);
  });
});

void test('the recorder refuses to freeze bytes carrying a credential value', () => {
  assert.throws(() => { assertNoCredentialMaterial('{"Authorization":"Bearer sk-live-1"}', ['sk-live-1']); },
    /refusing to freeze a source containing a credential value/);
  assertNoCredentialMaterial('{"locale":"en"}', ['sk-live-1', '']);
});

void test('two recordings of the same script freeze identical bytes', async () => {
  const first = await recordProbe();
  const second = await recordProbe();
  assert.deepEqual(second.map((entry) => entry.sourceText), first.map((entry) => entry.sourceText));
  assert.deepEqual(second, first);
});

void test('a frozen source carries no session identifier and no wall-clock reading', async () => {
  const recorded = await recordProbe();
  for (const entry of recorded) {
    assert.doesNotThrow(() => { assertCanonicalIdentifiers(entry.sourceText); });
    assert.doesNotThrow(() => { assertNoWallClockReadings(entry.sourceText); });
  }
  const [anime, place] = recorded;
  assert.equal(anime?.sourceText.includes('"key":"op-0001"'), true);
  assert.match(place?.metadata.prefix_state.references[0]?.entry_id ?? '', /^entry-\d{4}$/u);
});
