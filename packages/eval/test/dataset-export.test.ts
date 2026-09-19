import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import {
  exportedDatasetDocument,
  exportedDatasetText,
  exportedSetNames,
  fixtureDrift,
  fixtureDrifts,
  fixturePath,
} from '../src/dataset-export.ts';
import { FROZEN_DATASET_COUNTS } from '../src/dataset-sets.ts';
import { EVALUATOR_NAMES } from '../src/evaluator-names.ts';
import { objectOrNull } from '../src/json-object.ts';

/**
 * The committed dataset exports against their regeneration path (#1746).
 *
 * `fixtures/<set>.json` used to be bytes nothing in the tree could reproduce,
 * which is what held the `logfire`/`pydantic-evals` pair in `PINS.json`. These
 * tests are why it can no longer drift: the derivation in
 * `src/dataset-export.ts` runs on every `pnpm test`, and the committed bytes
 * have to be its output — so editing a fixture without its canonical input (or
 * the reverse) goes red here instead of surfacing as a mystery during a bump.
 *
 * The assertions below read the committed JSON rather than the module's types,
 * because a field typed `null` proves nothing about the bytes on disk.
 */

/** A committed export as JSON — the bytes, not the derivation's view of them. */
interface CommittedExport {
  readonly evaluators: readonly unknown[];
  readonly report_evaluators: readonly unknown[];
  readonly cases: readonly CommittedCase[];
}

interface CommittedCase {
  readonly name: string;
  readonly inputs: Readonly<Record<string, unknown>>;
  readonly expected_output: unknown;
  readonly evaluators: readonly unknown[];
}

function committedExport(setName: string): CommittedExport {
  return JSON.parse(readFileSync(fixturePath(setName), 'utf8')) as CommittedExport;
}

/** The committed cases that are not a preserved record: an expected output, or a per-case evaluator. */
function straysFromPreservedShape(setName: string): readonly string[] {
  return committedExport(setName).cases
    .filter((entry) => entry.expected_output !== null || entry.evaluators.length > 0)
    .map((entry) => entry.name);
}

void test('every committed dataset fixture reproduces its derivation byte for byte', () => {
  assert.deepEqual(fixtureDrifts(), []);
});

void test('the derivation covers exactly the frozen sets, in their declared order', () => {
  assert.deepEqual(exportedSetNames(), FROZEN_DATASET_COUNTS.map((set) => set.name));
});

// The committed roster is the export's half of the contract `evaluator-names.ts`
// declares: `logfire/evals` resolves each name through `FromOptions.customEvaluators`
// and fails loudly on an unregistered one, so a fixture carrying a name the TS side
// does not declare is a dataset that cannot be loaded at all.
void test('the committed exports carry the declared evaluator roster', () => {
  const rosters = exportedSetNames().map((setName) => committedExport(setName).evaluators);
  for (const roster of rosters) assert.deepEqual(roster, [...EVALUATOR_NAMES]);
});

void test('each derived document carries its frozen case count and its own evaluator rosters', () => {
  for (const frozen of FROZEN_DATASET_COUNTS) {
    const document = exportedDatasetDocument(frozen.name);
    assert.equal(document.cases.length, frozen.caseCount, frozen.name);
    assert.deepEqual(document.report_evaluators, [], frozen.name);
  }
});

void test('every committed case is a preserved record: no expected output, no per-case evaluator', () => {
  for (const frozen of FROZEN_DATASET_COUNTS) {
    assert.deepEqual(straysFromPreservedShape(frozen.name), [], frozen.name);
  }
});

void test('a derived case carries its canonical identity, prompt and locale', () => {
  const first = exportedDatasetDocument('agent_eval_heldout_v1').cases.at(0);
  assert.ok(first);
  assert.equal(first.name, 'HO_loc_ja_zhq_001');
  assert.equal(first.inputs.query, '冰菓的圣地在哪里');
  assert.equal(first.inputs.locale, 'ja');
});

// A set whose canonical rows carry no `query` at all: `injection_g1_v1` names its
// trigger `untrusted_content`, and the export wrote the empty prompt. The mapping
// reproduces that rather than inventing a prompt for it.
void test('a canonical row with no prompt exports the empty one', () => {
  const injected = committedExport('injection_g1_v1').cases;
  assert.deepEqual(injected.map((entry) => entry.inputs.query), injected.map(() => ''));
});

void test('a seeded selection and its nested payload survive into the inputs verbatim', () => {
  const seeded = exportedDatasetDocument('phase1c_selection_v1').cases.at(0);
  assert.ok(seeded);
  assert.deepEqual(seeded.inputs.selected_candidate_ids, ['115908', '11291']);
  assert.equal(seeded.inputs.clarification_id, 7);
  const pending = objectOrNull(seeded.inputs.seeded_pending);
  assert.ok(pending);
  assert.equal(pending.reason, 'anime_ambiguity');
});

void test('an export whose bytes moved is reported as drift, naming its set', () => {
  withPerturbedExport('input_guard_v1', (path) => {
    const drift = fixtureDrift('input_guard_v1', path);
    assert.ok(drift);
    assert.equal(drift.set, 'input_guard_v1');
    assert.notEqual(drift.committed, drift.derived);
  });
});

void test('an export still carrying the derived bytes is not reported as drift', () => {
  assert.equal(fixtureDrift('input_guard_v1'), null);
});

void test('the derived bytes are the export format: two-space indent, one trailing newline', () => {
  const text = exportedDatasetText('phase1c_selection_v1');
  assert.equal(text, `${JSON.stringify(JSON.parse(text), null, 2)}\n`);
});

function withPerturbedExport(setName: string, body: (path: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), 'dataset-export-'));
  try {
    const path = join(root, `${setName}.json`);
    writeFileSync(path, readFileSync(fixturePath(setName), 'utf8').replace('"query": "', '"query": "x'));
    body(path);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
