import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
import type { LoadedPrefixCorpus } from '../src/native/prefix-corpus.ts';
import { replaySelection, type SelectionReplayPorts } from '../src/native/prefix-selection.ts';
import { fixtureCatalog, type CatalogFixture } from './native-prefix-catalog.ts';
import { canonicalSelectionCases, phase1cCatalog, withRecordedCorpus } from './native-prefix-phase1c.ts';

function portsFor(fixture: CatalogFixture): SelectionReplayPorts {
  return { catalog: fixtureCatalog([], fixture), commit: 'tested-commit' };
}

void test('all five phase1c cases select deterministically from their own native fork without SELECTION_EXPIRED', async () => {
  await withRecordedCorpus(async (replay, corpus) => {
    const canonical = await canonicalSelectionCases();
    const report = await replaySelection(replay, corpus, portsFor(phase1cCatalog(canonical)), BACKGROUND_CONTEXT);
    assert.equal(report.kind, 'deterministic-selection-replay');
    assert.equal(report.model_calls, 0);
    assert.deepEqual(report.cases.map((entry) => entry.name), canonical.map((entry) => entry.id));
    assert.deepEqual(report.cases.map((entry) => entry.selection_status), ['ok', 'ok', 'empty', 'ok', 'ok']);
    assert.deepEqual(report.cases.map((entry) => entry.faults), [[], [], [], [], []]);
    assert.deepEqual(report.cases.map((entry) => entry.status), Array.from({ length: 5 }, () => 'pass'));
    assert.deepEqual(report.cases.map((entry) => entry.candidates), canonical.map((entry) => entry.seeded_pending.ordered_candidates));
    assert.deepEqual(report.cases.map((entry) => entry.reference.tool),
      ['search_bangumi', 'search_bangumi', 'search_bangumi', 'search_bangumi', 'search_nearby']);
    assert.deepEqual(report.cases.map((entry) => entry.clarification_id > 0), Array.from({ length: 5 }, () => true));
    // The record asserts the same reference distinctness the pre-canonical uuids
    // carried: a placeholder is scoped to its own frozen source, so a durable
    // reference is identified by that source plus its entry id, never by the
    // bare token five sources each mint from their own first appearance.
    assert.equal(new Set(report.cases.map((entry) => `${entry.name}:${entry.reference.entry_id}`)).size, 5);
    assert.deepEqual(report.cases.map((entry) => /^entry-\d{4}$/u.test(entry.reference.entry_id)), Array.from({ length: 5 }, () => true));
  });
});

void test('a deterministic selection that returns nothing for an expected non-empty case fails the replay', async () => {
  await withRecordedCorpus(async (replay, corpus) => {
    const fixture = phase1cCatalog(await canonicalSelectionCases());
    const report = await replaySelection(replay, corpus, portsFor({ ...fixture, works: { '115908': [], '11291': [] } }), BACKGROUND_CONTEXT);
    const first = report.cases[0];
    assert.ok(first);
    assert.deepEqual(first.faults,
      ['expected selection status ok but got empty', 'the selection result does not match the expected non-emptiness']);
  });
});

void test('a selection the boundary never offered is refused as an expired clarification', async () => {
  await withRecordedCorpus(async (replay, corpus) => {
    const first = corpus.cases[0];
    assert.ok(first);
    const mutated: LoadedPrefixCorpus = { name: corpus.name,
      cases: [{ ...first, inputs: { ...first.inputs, selection: { candidateIds: ['999001'] } } }, ...corpus.cases.slice(1)] };
    const refused = await replaySelection(replay, mutated, portsFor(phase1cCatalog(await canonicalSelectionCases())), BACKGROUND_CONTEXT);
    const refusedCase = refused.cases[0];
    assert.ok(refusedCase);
    assert.equal(refusedCase.selection_status, null);
    assert.match(refusedCase.faults.join(' '), /This choice expired; please try again\./);
  });
});
