import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { FROZEN_DATASET_COUNTS } from '../src/dataset-sets.ts';
import {
  SUITE_PINS,
  SUITE_ROSTER_BLOCKERS,
  suiteCoverageGaps,
  suitePin,
  validateSuiteRoster,
  type SuitePin,
  type SuiteRosterCase,
} from '../src/native/suite-pins.ts';
import type { CaseCategory } from '../src/native/required-assertions.ts';
import { objectOrNull } from '../src/json-object.ts';

type CanonicalCase = Readonly<Record<string, unknown>>;

function canonical(name: string): readonly CanonicalCase[] {
  const directory = name === 'agent_eval_v3' ? '../datasets/source' : '../datasets/canonical';
  const raw: unknown = JSON.parse(readFileSync(new URL(`${directory}/${name}.json`, import.meta.url), 'utf8'));
  if (Array.isArray(raw)) return raw as readonly CanonicalCase[];
  return (raw as { readonly cases: readonly CanonicalCase[] }).cases;
}

/** `inputs.locale` or a top-level `locale`; the canonical exports are not uniform. */
function localesOf(cases: readonly CanonicalCase[]): readonly string[] {
  return cases.flatMap((entry) => {
    const nested = objectOrNull(entry.inputs)?.locale;
    const locale = typeof entry.locale === 'string' ? entry.locale : nested;
    return typeof locale === 'string' ? [locale] : [];
  });
}

function stagesOf(cases: readonly CanonicalCase[]): readonly string[] {
  return cases.flatMap((entry) => {
    const stages = entry.acceptable_stages ?? objectOrNull(entry.metadata)?.acceptable_stages;
    return Array.isArray(stages) ? stages.filter((stage): stage is string => typeof stage === 'string') : [];
  });
}

/** A synthetic roster that satisfies each declared floor, for validation tests. */
function rosterOf(pin: SuitePin): SuiteRosterCase[] {
  const locales = Object.keys(pin.coverage.localeMinimums);
  const stages = Object.keys(pin.coverage.stageMinimums);
  const categories = Object.entries(pin.coverage.categoryMinimums);
  return Array.from({ length: pin.caseCount }, (_, index) => {
    const [category] = categories[index % categories.length] ?? ['end-to-end'];
    const stage = stages[index % stages.length];
    return {
      name: `${category}_${String(index)}`,
      locale: locales[index % locales.length] ?? 'ja',
      category: category as CaseCategory,
      stages: stage === undefined ? [] : [stage],
    };
  });
}

/** The validated roster, so an assertion callback is a value-returning call. */
function checked(pin: SuitePin, roster: readonly SuiteRosterCase[]): readonly SuiteRosterCase[] {
  validateSuiteRoster(pin, roster);
  return roster;
}

void test('the three suites are committed with their k, target size and wall-clock budget', () => {
  assert.deepEqual(SUITE_PINS.map((pin) => [pin.name, pin.caseCount, pin.repeat, pin.wallClockMinutes]), [
    ['prefix_gate_v1', 60, 1, 5],
    ['reliability_v1', 40, 5, 20],
    ['profile_v1', 250, 1, 45],
  ]);
  assert.throws(() => suitePin('not-a-suite'), /unknown suite/);
});

void test('no suite roster is committed while the native task wiring is incomplete', () => {
  assert.deepEqual(Object.keys(SUITE_ROSTER_BLOCKERS).sort(), ['prefix_gate_v1', 'profile_v1', 'reliability_v1']);
  assert.match(SUITE_ROSTER_BLOCKERS.prefix_gate_v1 ?? '', /#1558/);
});

void test('the frozen corpus preserves the provenance every suite must draw from', () => {
  const v3 = canonical('agent_eval_v3');
  const heldout = canonical('agent_eval_heldout_v1');
  assert.deepEqual([...new Set(localesOf([...v3, ...heldout]))].sort(), ['en', 'ja', 'zh']);
  assert.deepEqual(['injection_g1_v1', 'input_guard_v1', 'long_context_v1', 'translation_v1']
    .map((name) => canonical(name).length), [23, 15, 13, 65]);
  assert.deepEqual([...new Set(stagesOf(v3))].sort(), ['clarify', 'clarify_after_nearby', 'general_qa', 'greet_user',
    'plan_route', 'plan_selected', 'search_bangumi', 'search_nearby']);
  assert.deepEqual(FROZEN_DATASET_COUNTS.map((entry) => entry.caseCount), [662, 33, 23, 15, 13, 5]);
});

void test('a roster that keeps the committed count and coverage validates', () => {
  for (const pin of SUITE_PINS) {
    const roster = rosterOf(pin);
    assert.equal(roster.length, pin.caseCount, `${pin.name} fixture must be the committed size`);
    assert.deepEqual(suiteCoverageGaps(pin, roster), []);
    assert.doesNotThrow(() => checked(pin, roster));
  }
});

void test('a roster one case short of its committed count is refused', () => {
  const pin = suitePin('reliability_v1');
  assert.throws(() => checked(pin, rosterOf(pin).slice(0, -1)),
    /reliability_v1: committed roster is 40 cases, got 39/);
});

void test('a roster that loses a locale or a safety case is refused', () => {
  const pin = suitePin('reliability_v1');
  const roster = rosterOf(pin);
  const englishOnly = roster.map((entry) => ({ ...entry, locale: 'en' }));
  assert.deepEqual(suiteCoverageGaps(pin, englishOnly),
    ['locale ja has 0 cases, minimum 1', 'locale zh has 0 cases, minimum 1']);
  const withoutSafety = roster.map((entry) => ({ ...entry, category: 'end-to-end' as CaseCategory }));
  assert.deepEqual(suiteCoverageGaps(pin, withoutSafety), ['category safety has 0 cases, minimum 3']);
});

void test('a roster that loses its stage coverage is refused', () => {
  const pin = suitePin('profile_v1');
  const flat = rosterOf(pin).map((entry) => ({ ...entry, stages: ['search_bangumi'] }));
  assert.deepEqual(suiteCoverageGaps(pin, flat).slice(0, 2),
    ['stage general_qa has 0 cases, minimum 8', 'stage clarify has 0 cases, minimum 8']);
});

void test('a roster that names a case twice is refused instead of counted twice', () => {
  const pin = suitePin('prefix_gate_v1');
  const roster = rosterOf(pin);
  const first = roster[0];
  assert.ok(first);
  assert.throws(() => checked(pin, [...roster.slice(0, -1), first]),
    /prefix_gate_v1: roster names case .* twice/);
});
