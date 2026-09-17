import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { FROZEN_DATASET_COUNTS, frozenDataset } from '../src/dataset-sets.ts';
import {
  canonicalDatasetPath,
  caseStrataFromText,
  loadCaseStrata,
  pooledStratumWarning,
} from '../src/gate/case-strata.ts';
import { oracleEntryNamed, readStatsOracle } from '../src/gate/stats-oracle.ts';

const PACKAGE_DIR = fileURLToPath(new URL('../', import.meta.url));
/** The frozen set this file stratifies, and the counts it was frozen at. */
const AGENT_EVAL_V3 = frozenDataset('agent_eval_v3');
const oracle = readStatsOracle().case_strata;
const strata = loadCaseStrata(canonicalDatasetPath(AGENT_EVAL_V3.name));

/**
 * The canonical directory moved inside this package (#1603). That is the one
 * thing the rest of this file assumes, and the one thing a rename-away proof
 * alone cannot show: a copy with a missing file would load nothing and fail no
 * test that reads the Python agent's tree instead.
 */
void test('the canonical datasets resolve inside this package', () => {
  const dataset = canonicalDatasetPath(AGENT_EVAL_V3.name);
  assert.ok(dataset.startsWith(PACKAGE_DIR), dataset);
  assert.ok(existsSync(dataset), dataset);
});

/**
 * Every count in the table, proved against the canonical copy it names: the
 * table is the freeze witness for all six sets, not a spare dimension nobody
 * reads. The stratum count compares the same way for a set with no `path`
 * column at all — it pools every case into one stratum — which is why the
 * table's `stratumCount` cannot stand in for the pooled list below.
 */
for (const set of FROZEN_DATASET_COUNTS) {
  void test(`${set.name}: the canonical copy holds every declared case`, () => {
    const canonical = loadCaseStrata(canonicalDatasetPath(set.name));
    assert.equal(Object.keys(canonical.byCase).length, set.caseCount);
  });

  void test(`${set.name}: the canonical copy spreads over the declared strata`, () => {
    const canonical = loadCaseStrata(canonicalDatasetPath(set.name));
    assert.equal(new Set(Object.values(canonical.byCase)).size, set.stratumCount);
  });
}

void test('a stratified dataset warns about nothing', () => {
  assert.deepEqual(strata.warnings, []);
});

void test('a known case keeps its behaviour family', () => {
  assert.equal(strata.byCase.A1_ja_001, 'exact_db_api_ok');
});

/** #1478: every canonical set with no `path` column pools into one stratum. */
const POOLED_SETS = [
  'injection_g1_v1',
  'input_guard_v1',
  'phase1c_selection_v1',
  'runtime_journey_v1',
  'translation_v1',
] as const;

for (const setName of POOLED_SETS) {
  void test(`${setName}: no path column, so one stratum`, () => {
    const pooled = loadCaseStrata(canonicalDatasetPath(setName));
    assert.deepEqual([...new Set(Object.values(pooled.byCase))], ['unstratified']);
  });

  void test(`${setName}: says so, naming the dataset and the pooled interval`, () => {
    const pooled = loadCaseStrata(canonicalDatasetPath(setName));
    assert.deepEqual(pooled.warnings, [pooledStratumWarning(setName)]);
  });
}

void test('a row without an id is refused, pooled or not', () => {
  assert.throws(
    () => caseStrataFromText('[{"id": "a"}, {}]', 'set'),
    /set: row 1 has no string "id"/,
  );
});

/** A bare `SyntaxError` names no set, and Python words it differently — neither
 * is traceable nor comparable across the two runners. */
void test('a dataset that is not JSON is refused by name', () => {
  assert.throws(() => caseStrataFromText('[{"id": "a", "path": "p"},', 'set'), {
    message: 'set: invalid JSON',
  });
});

/**
 * Python's recorded answer comes in one of two shapes, and an entry's table is
 * that shape: the strata it loaded, or the refusal it raised. Naming the rows
 * in two tables is what keeps every test body straight-line — `strata` rows
 * deep-equal the loaded strata, refusal rows assert the throw, and no branch
 * on the answer's shape lives inside a test.
 */
const ORACLE_STRATA_CASES = ['path_column', 'no_path_column', 'empty_set'] as const;
const ORACLE_REFUSAL_CASES = [
  'partial_path_column',
  'non_string_path',
  'row_without_id',
  'pooled_row_without_id',
  'not_a_list',
  'invalid_json',
] as const;

/** The two tables together are the oracle's whole `case_strata` content: a row
 * that fell out of the split would otherwise never run and never fail. */
void test('the two tables name every oracle case exactly once', () => {
  const split = [...ORACLE_STRATA_CASES, ...ORACLE_REFUSAL_CASES];
  assert.deepEqual(split.sort(), oracle.map((entry) => entry.name).sort());
});

for (const name of ORACLE_STRATA_CASES) {
  void test(`${name}: the same strata Python loads`, () => {
    const entry = oracleEntryNamed(oracle, name);
    assert.equal(entry.error, null);
    assert.deepEqual(caseStrataFromText(entry.text, entry.dataset), {
      byCase: entry.strata,
      warnings: entry.warnings,
    });
  });
}

for (const name of ORACLE_REFUSAL_CASES) {
  void test(`${name}: the same refusal Python records`, () => {
    const entry = oracleEntryNamed(oracle, name);
    assert.equal(entry.strata, null);
    assert.ok(entry.error !== null);
    assert.throws(() => caseStrataFromText(entry.text, entry.dataset), { message: entry.error });
  });
}
