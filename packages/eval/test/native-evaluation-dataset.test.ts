import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadNativeDataset } from '../src/native/evaluation-dataset.ts';

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

void test('runtime_journey_v1 is refused as an unmigrated preserved corpus set', async () => {
  await assert.rejects(loadNativeDataset('runtime_journey_v1', false), /runtime_journey_v1 is a preserved corpus set/);
});

void test('translation_v1 is refused as an unmigrated preserved corpus set', async () => {
  await assert.rejects(loadNativeDataset('translation_v1', false), /translation_v1 is a preserved corpus set/);
});
