import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import type { BaselineRecord } from '../src/gate/baseline-record.ts';
import {
  baselinePath,
  readBaselineRecord,
  writeBaselineRecord,
  type BaselineLocation,
  type BaselineReadResult,
} from '../src/gate/baseline-store.ts';
import {
  oracleEntryAt,
  oracleEntryNamed,
  PYTHON_BASELINE_LAYER,
  PYTHON_BASELINE_MODEL,
  readStatsOracle,
  type OracleStalenessCase,
} from '../src/gate/stats-oracle.ts';

const oracle = readStatsOracle();
const LAYER = PYTHON_BASELINE_LAYER;
const MODEL = PYTHON_BASELINE_MODEL;

function scratchLocation(): BaselineLocation {
  const baselinesDir = mkdtempSync(join(tmpdir(), 'animichi-staleness-'));
  return { layer: LAYER, modelId: MODEL, baselinesDir };
}

function readWritten(record: BaselineRecord, entry: OracleStalenessCase): BaselineReadResult {
  const location = scratchLocation();
  writeBaselineRecord(record, location);
  return readBaselineRecord(location, {
    caseCount: entry.expected_case_count ?? undefined,
    metrics: entry.expected_metrics ?? undefined,
  });
}

for (const entry of oracle.baseline_staleness) {
  void test(`${entry.name}: the same warnings Python logs`, () => {
    const result = readWritten(entry.record, entry);
    assert.deepEqual(result.warnings, entry.warnings);
  });

  void test(`${entry.name}: the record is kept or dropped as Python decides`, () => {
    const result = readWritten(entry.record, entry);
    assert.equal(result.record !== null, entry.loaded);
  });
}

void test('a missing baseline names the file it looked for', () => {
  const location = scratchLocation();
  const result = readBaselineRecord(location);
  assert.deepEqual(result, {
    record: null,
    warnings: [`Missing baseline for ${LAYER}/${MODEL} at ${baselinePath(location)}`],
  });
});

void test('an unreadable baseline is a warning, not a crash', () => {
  const location = scratchLocation();
  writeFileSync(baselinePath(location), '{ not json', 'utf8');
  const result = readBaselineRecord(location);
  assert.equal(result.record, null);
  assert.match(oracleEntryAt(result.warnings, 0), /^Invalid baseline for /);
});

void test('a fresh record is returned with nothing to say about it', () => {
  const entry = oracleEntryNamed(oracle.baseline_staleness, 'fresh');
  assert.deepEqual(readWritten(entry.record, entry).record, entry.record);
});
