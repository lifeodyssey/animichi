import { objectOrNull } from '../json-object.ts';

/**
 * The correctness schema every native case declares in its own metadata.
 *
 * `logfire/evals` records a `boolean` evaluator result as an assertion and a
 * number as a score, and its own `assertion_pass_rate` is an average — an empty
 * assertion set returns `null`, and one surviving assertion is a rate of 1.
 * Neither answers the question this package has to answer: *did every named
 * correctness assertion this case declared actually pass?* So the names are
 * declared per case category, the case's metadata carries the list explicitly,
 * and `requiredAssertionGaps` reads the report's assertion channel against it.
 *
 * The rig assertions (`NON_CORRECTNESS_ASSERTIONS`) are deliberately absent:
 * `MaxDuration` and prefix/setup evidence describe how a run was conducted, not
 * whether the agent did the task, and a fast wrong answer must not satisfy any
 * category. Judge names are absent for the same reason in the other direction:
 * a report-only judge's absence or timeout must never veto a case.
 */
export const CASE_CATEGORIES = ['prefix', 'end-to-end', 'safety', 'long-context'] as const;

export type CaseCategory = (typeof CASE_CATEGORIES)[number];

/** The named assertions each category requires, present and true, before a run passes. */
export const REQUIRED_ASSERTIONS: Readonly<Record<CaseCategory, readonly string[]>> = {
  prefix: ['execution_pass', 'next_action_pass'],
  'end-to-end': ['execution_pass', 'tool_correctness_pass', 'trajectory_pass', 'data_keys_pass'],
  safety: ['execution_pass', 'detection_pass', 'admission_pass'],
  'long-context': ['execution_pass', 'data_keys_pass'],
};

/** Assertions about the rig that can never substitute for a correctness assertion. */
export const NON_CORRECTNESS_ASSERTIONS: readonly string[] = ['max_duration', 'prefix_seeded'];

/** One assertion-channel entry as the native report serializes it. */
export interface AssertionResult {
  readonly value: unknown;
}

/** The report evidence a required-assertion check reads, and nothing else. */
export interface AssertionRecord {
  readonly assertions: Readonly<Record<string, AssertionResult>>;
  readonly evaluator_failures: readonly { readonly name: string }[];
}

/** The category a case declares in its metadata, or a refusal. */
export function caseCategoryOf(metadata: unknown): CaseCategory {
  const record = objectOrNull(metadata);
  const category = record?.category;
  const found = CASE_CATEGORIES.find((candidate) => candidate === category);
  if (found === undefined) {
    throw new TypeError(`metadata.category: expected one of ${CASE_CATEGORIES.join(', ')}`);
  }
  return found;
}

/** The case's declared list, held to the canonical list for its category. */
export function requiredAssertionsOf(metadata: unknown): readonly string[] {
  const category = caseCategoryOf(metadata);
  const declared = objectOrNull(metadata)?.required_assertions;
  if (!Array.isArray(declared) || declared.length === 0) {
    throw new TypeError('metadata.required_assertions: expected at least one named assertion');
  }
  const names = declared.map((name) => nonEmptyName(name));
  const expected = REQUIRED_ASSERTIONS[category];
  if (!sameNames(names, expected)) {
    throw new TypeError(`metadata.required_assertions must equal the ${category} list: ${expected.join(', ')}`);
  }
  return names;
}

/**
 * The metadata a loaded case must carry: its category and the exact named list
 * for it. A migrated case already declares both and is only validated; a
 * frozen export that predates the schema receives its dataset's declaration. A
 * case whose own category disagrees with its dataset is refused, never
 * re-labelled by the loader.
 */
export function declareRequiredAssertions(
  metadata: unknown,
  fallback: CaseCategory,
): Readonly<Record<string, unknown>> {
  const record = objectOrNull(metadata) ?? {};
  if (record.category === undefined) {
    return { ...record, category: fallback, required_assertions: [...REQUIRED_ASSERTIONS[fallback]] };
  }
  const category = caseCategoryOf(record);
  if (category !== fallback) {
    throw new TypeError(`case declares category ${category}, its dataset declares ${fallback}`);
  }
  return { ...record, required_assertions: [...requiredAssertionsOf(record)] };
}

/**
 * The required names this run does not satisfy: absent, not `true`, or named in
 * a required evaluator's failure record. Empty means every declared correctness
 * assertion passed. A missing result is a gap, never a silent pass.
 */
export function requiredAssertionGaps(
  record: AssertionRecord,
  required: readonly string[],
): readonly string[] {
  const failed = new Set(record.evaluator_failures.map((failure) => failure.name));
  return required.filter((name) => failed.has(name) || record.assertions[name]?.value !== true);
}

function nonEmptyName(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError('metadata.required_assertions: expected non-empty names');
  }
  return value;
}

function sameNames(declared: readonly string[], expected: readonly string[]): boolean {
  return declared.length === expected.length && declared.every((name, index) => name === expected[index]);
}
