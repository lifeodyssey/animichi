import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { canonicalDatasetPath, loadCaseStrata } from '../src/gate/case-strata.ts';
import { fixturePath } from '../src/dataset-roundtrip.ts';

const strata = loadCaseStrata(canonicalDatasetPath('agent_eval_v3'));

void test('every canonical case carries a behaviour path', () => {
  assert.equal(Object.keys(strata).length, 662);
});

void test('a known case keeps its behaviour family', () => {
  assert.equal(strata.A1_ja_001, 'exact_db_api_ok');
});

void test('the 662 cases spread over the behaviour families the gate stratifies by', () => {
  assert.equal(new Set(Object.values(strata)).size, 66);
});

void test('the exported dataset carries no path, so the strata cannot come from it', () => {
  const exported = readFileSync(fixturePath('agent_eval_v3'), 'utf8');
  assert.equal(exported.includes('"path"'), false);
});

void test('a row without a path is a loud failure, not an unstratified case', () => {
  const directory = mkdtempSync(join(tmpdir(), 'animichi-strata-'));
  const path = join(directory, 'rows.json');
  writeFileSync(path, '[{"id": "a", "path": "p"}, {"id": "b"}]', 'utf8');
  assert.throws(() => loadCaseStrata(path), /row 1 has no string "id" and "path"/);
});

void test('a dataset that is not a list of rows is refused', () => {
  assert.throws(() => loadCaseStrata(fixturePath('agent_eval_v3')), /must be a list of rows/);
});
