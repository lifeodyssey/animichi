import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadNativeDataset, plannedCases } from '../src/native/evaluation-dataset.ts';
import { FROZEN_DATASET_CATEGORY } from '../src/dataset-sets.ts';
import { REQUIRED_ASSERTIONS } from '../src/native/required-assertions.ts';

void test('the E1 loader preserves all 33 source cases and selects exactly three for smoke', async () => {
  const full = await loadNativeDataset('agent_eval_heldout_v1', false);
  const smoke = await loadNativeDataset('agent_eval_heldout_v1', true);
  assert.deepEqual([full.sourceCaseCount, full.selectedCaseCount, smoke.selectedCaseCount], [33, 33, 3]);
  assert.deepEqual(full.unsupportedShapes, {});
  assert.deepEqual(smoke.dataset.cases.map((entry) => entry.name), ['HO_loc_ja_zhq_001', 'HO_loc_ja_enq_001', 'HO_loc_zh_jaq_001']);
});

void test('the larger v3 corpus reports unsupported task shapes instead of dropping cases', async () => {
  await assert.rejects(loadNativeDataset('agent_eval_v3', false),
    /agent_eval_v3: unsupported native task shapes \(session-preseed=23, selection-prefix=12\)/);
});

void test('a known dataset typo is refused before any model setup', async () => {
  await assert.rejects(loadNativeDataset('not-a-dataset', false), /unknown dataset/);
});

void test('phase1c_selection_v1 is refused as a flat prompt because its cases own recorded prefix forks', async () => {
  await assert.rejects(loadNativeDataset('phase1c_selection_v1', false),
    /phase1c_selection_v1 is evaluated from recorded native prefix forks/);
});

void test('runtime_journey_v1 is refused as an unmigrated preserved corpus set', async () => {
  await assert.rejects(loadNativeDataset('runtime_journey_v1', false), /runtime_journey_v1 is a preserved corpus set/);
});

void test('translation_v1 is refused as an unmigrated preserved corpus set', async () => {
  await assert.rejects(loadNativeDataset('translation_v1', false), /translation_v1 is a preserved corpus set/);
});

void test('every frozen set declares a case category for its cases', () => {
  assert.deepEqual(Object.keys(FROZEN_DATASET_CATEGORY).sort(),
    ['agent_eval_heldout_v1', 'agent_eval_v3', 'injection_g1_v1', 'input_guard_v1', 'long_context_v1',
      'phase1c_selection_v1']);
  assert.deepEqual(Object.values(FROZEN_DATASET_CATEGORY), ['end-to-end', 'end-to-end', 'safety', 'safety',
    'long-context', 'prefix']);
});

void test('a frozen export receives its dataset category and canonical assertion list on load', async () => {
  const loaded = await loadNativeDataset('input_guard_v1', false);
  for (const entry of loaded.dataset.cases) {
    const metadata = entry.metadata;
    assert.ok(metadata);
    assert.equal(metadata.category, 'safety');
    assert.deepEqual(metadata.required_assertions, [...REQUIRED_ASSERTIONS.safety]);
  }
});

void test('the planned case list carries each case name and its required assertions', async () => {
  const loaded = await loadNativeDataset('agent_eval_heldout_v1', true);
  assert.deepEqual(plannedCases(loaded), loaded.dataset.cases.map((entry) => ({
    name: entry.name, requiredAssertions: [...REQUIRED_ASSERTIONS['end-to-end']],
  })));
});
