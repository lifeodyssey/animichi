import assert from 'node:assert/strict';
import { basename, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import { readCaptureConfig } from '../scripts/record-captures.ts';
import { formatReport, readSelectionReplayConfig } from '../scripts/replay-prefix-selection.ts';
import type { SelectionReplayReport } from '../src/native/prefix-selection.ts';

void test('the deterministic recorder runs without a credential and default to the committed corpus directory', () => {
  const config = readCaptureConfig({ EVAL_RECORD_MODE: 'deterministic', EVAL_DATASET: 'phase1c_selection_v1',
    EVAL_COMMIT: 'tested-commit' });
  assert.deepEqual({ dataset: config.dataset, deterministic: config.deterministic, commit: config.commit },
    { dataset: 'phase1c_selection_v1', deterministic: true, commit: 'tested-commit' });
  assert.equal(config.out.endsWith('fixtures/prefix-corpus'), true);
});

void test('a dataset without a recorded prefix corpus is refused by name', () => {
  assert.throws(() => readCaptureConfig({ EVAL_DATASET: 'agent_eval_heldout_v1', EVAL_COMMIT: 'tested-commit' }),
    /no recorded prefix corpus is defined for it/);
});

void test('the replay command needs a catalog origin and defaults its report to the OS temporary directory', () => {
  assert.throws(() => readSelectionReplayConfig({ EVAL_COMMIT: 'tested-commit' }),
    /requires CATALOG_API_URL/);
  const config = readSelectionReplayConfig({ CATALOG_API_URL: 'https://catalog.example.com', EVAL_COMMIT: 'tested-commit' });
  assert.deepEqual([config.commit, dirname(config.reportPath), basename(config.reportPath)],
    ['tested-commit', tmpdir(), 'prefix-selection-phase1c_selection_v1.json']);
});

void test('the replay report prints the verified boundary state per case', () => {
  const report: SelectionReplayReport = { kind: 'deterministic-selection-replay', dataset: 'phase1c_selection_v1',
    model_calls: 0, commit: 'tested-commit', sdk: '0.85.1', cases: [{ name: 'D3_multi_success_two', status: 'pass',
      clarification_id: 7, candidates: [{ id: '115908' }], reference: { entry_id: 'entry-3', tool: 'search_bangumi' },
      selection_status: 'ok', omitted: [], row_count: 2, faults: [] }] };
  assert.equal(formatReport(report), 'phase1c_selection_v1: 1 cases, model calls 0, commit tested-commit\n'
    + '  pass D3_multi_success_two: ok clarification=7 reference=entry-3 rows=2');
});
