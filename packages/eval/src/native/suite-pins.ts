import type { CaseCategory } from './required-assertions.ts';

/**
 * The three eval suites as committed declarations: their size, their repeat
 * (k) and their wall-clock budget are product policy, not something a run may
 * renegotiate by dropping a difficult case. This module owns that policy as
 * data, and holds a roster to it.
 *
 * The rosters themselves are not committed yet, and the module says why rather
 * than letting a shortfall look like a smaller suite. `prefix_gate_v1` needs
 * the native prefix task wiring (#1558): the frozen prefix shapes are preserved
 * but not runnable, so a prefix roster cannot be loaded and must not be
 * approximated from prompt-only cases. `reliability_v1` and `profile_v1` wait
 * on the corpus migration and the retirement review. What *is* committed is the
 * count, the k, the budget and the coverage floor a roster must keep — the
 * counts the frozen sources establish are provenance, not a finished roster.
 *
 * The coverage floors are the canonical suite decisions: `profile_v1` keeps
 * three locales at ≥60 cases each, every acceptable stage at ≥8, all 38 safety
 * cases (23 injection + 15 input guard) and ≥5 long-context cases; the
 * reliability suite keeps the three locales, at least four stages and ≥3 safety
 * cases. Translation coverage migrates into `profile_v1` once the 65 preserved
 * translation cases have their native expectations.
 */
export const SUITE_NAMES = ['prefix_gate_v1', 'reliability_v1', 'profile_v1'] as const;

export type SuiteName = (typeof SUITE_NAMES)[number];

export interface SuiteCoverage {
  /** Minimum cases per `inputs.locale`; the locale is never parsed from the name. */
  readonly localeMinimums: Readonly<Record<string, number>>;
  /** Minimum cases per `metadata.acceptable_stages` value. */
  readonly stageMinimums: Readonly<Record<string, number>>;
  /** Minimum cases per case category. */
  readonly categoryMinimums: Readonly<Partial<Record<CaseCategory, number>>>;
}

export interface SuitePin {
  readonly name: SuiteName;
  /** The committed roster size; a roster of another size is refused. */
  readonly caseCount: number;
  /** `repeat`, which is pass^k's k. */
  readonly repeat: number;
  readonly wallClockMinutes: number;
  readonly coverage: SuiteCoverage;
}

export const SUITE_PINS: readonly SuitePin[] = [
  {
    name: 'prefix_gate_v1',
    caseCount: 60,
    repeat: 1,
    wallClockMinutes: 5,
    coverage: {
      localeMinimums: { ja: 1, zh: 1, en: 1 },
      stageMinimums: {},
      categoryMinimums: { prefix: 60 },
    },
  },
  {
    name: 'reliability_v1',
    caseCount: 40,
    repeat: 5,
    wallClockMinutes: 20,
    coverage: {
      localeMinimums: { ja: 1, zh: 1, en: 1 },
      stageMinimums: { search_bangumi: 1, general_qa: 1, clarify: 1, plan_route: 1 },
      categoryMinimums: { safety: 3 },
    },
  },
  {
    name: 'profile_v1',
    caseCount: 250,
    repeat: 1,
    wallClockMinutes: 45,
    coverage: {
      localeMinimums: { ja: 60, zh: 60, en: 60 },
      stageMinimums: {
        search_bangumi: 8, general_qa: 8, clarify: 8, search_nearby: 8,
        clarify_after_nearby: 8, plan_route: 8, greet_user: 8, plan_selected: 8,
      },
      categoryMinimums: { prefix: 1, 'end-to-end': 1, safety: 38, 'long-context': 5 },
    },
  },
];

/** Each suite's roster is blocked, and on what. */
export const SUITE_ROSTER_BLOCKERS: Readonly<Partial<Record<SuiteName, string>>> = {
  prefix_gate_v1: 'native prefix task wiring (#1558): frozen prefix shapes load only after it',
  reliability_v1: 'corpus migration plus the retirement review that fixes the roster',
  profile_v1: 'corpus migration plus the retirement review that fixes the roster',
};

/** A roster case as the suite validator reads it. */
export interface SuiteRosterCase {
  readonly name: string;
  readonly locale: string;
  readonly category: CaseCategory;
  readonly stages: readonly string[];
}

/** The committed pin for a suite name, or a refusal naming the three. */
export function suitePin(name: string): SuitePin {
  const found = SUITE_PINS.find((pin) => pin.name === name);
  if (found === undefined) throw new RangeError(`unknown suite "${name}" — one of: ${SUITE_NAMES.join(', ')}`);
  return found;
}

/** The coverage floors a roster does not meet, one message per lost floor. */
export function suiteCoverageGaps(pin: SuitePin, roster: readonly SuiteRosterCase[]): readonly string[] {
  return [
    ...shortfalls('locale', localeCounts(roster), pin.coverage.localeMinimums),
    ...shortfalls('stage', stageCounts(roster), pin.coverage.stageMinimums),
    ...shortfalls('category', categoryCounts(roster), pin.coverage.categoryMinimums),
  ];
}

/** Hold a roster to its committed size, unique identities and coverage floors. */
export function validateSuiteRoster(pin: SuitePin, roster: readonly SuiteRosterCase[]): void {
  if (roster.length !== pin.caseCount) {
    throw new RangeError(`${pin.name}: committed roster is ${String(pin.caseCount)} cases, got ${String(roster.length)}`);
  }
  rejectDuplicateNames(pin, roster);
  const gaps = suiteCoverageGaps(pin, roster);
  if (gaps.length > 0) throw new RangeError(`${pin.name}: coverage: ${gaps.join('; ')}`);
}

function rejectDuplicateNames(pin: SuitePin, roster: readonly SuiteRosterCase[]): void {
  const seen = new Set<string>();
  for (const entry of roster) {
    if (seen.has(entry.name)) throw new RangeError(`${pin.name}: roster names case ${entry.name} twice`);
    seen.add(entry.name);
  }
}

function localeCounts(roster: readonly SuiteRosterCase[]): ReadonlyMap<string, number> {
  return counted(roster.map((entry) => entry.locale));
}

function stageCounts(roster: readonly SuiteRosterCase[]): ReadonlyMap<string, number> {
  return counted(roster.flatMap((entry) => [...entry.stages]));
}

function categoryCounts(roster: readonly SuiteRosterCase[]): ReadonlyMap<string, number> {
  return counted(roster.map((entry) => entry.category));
}

function counted(values: readonly string[]): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return counts;
}

function shortfalls(
  kind: string,
  counts: ReadonlyMap<string, number>,
  minimums: Readonly<Partial<Record<string, number>>>,
): readonly string[] {
  return Object.entries(minimums).flatMap(([name, minimum]) => {
    const count = counts.get(name) ?? 0;
    return minimum === undefined || count >= minimum ? []
      : [`${kind} ${name} has ${String(count)} cases, minimum ${String(minimum)}`];
  });
}
