import type { CaseCategory } from './native/required-assertions.ts';

/**
 * The six canonical datasets that were exported from Python, and the frozen
 * counts each one must keep.
 *
 * The counts are a tripwire, not a derived value: a fixture that silently
 * shrinks (a truncated export, an `EVAL_MAX_CASES` leak into the exporter)
 * would otherwise still load and still deep-equal itself. There is no exporter
 * any more (#1603) — the fixtures are frozen bytes and the canonical sets they
 * were produced from live in `datasets/canonical/` — so these numbers are the
 * only remaining check that a set is the size it was frozen at. `stratumCount`
 * is the same tripwire for the canonical set's `path` column: one stratum for a
 * set with no `path` at all, the distinct behaviour-family count otherwise.
 * The two canonical sets that were never exported (`runtime_journey_v1`,
 * `translation_v1`) have no row here; `test/gate-case-strata.test.ts` names
 * them as pooled instead.
 */
export interface FrozenDatasetCount {
  readonly caseCount: number;
  readonly name: string;
  readonly stratumCount: number;
}

export const FROZEN_DATASET_COUNTS: readonly FrozenDatasetCount[] = [
  { caseCount: 662, name: 'agent_eval_v3', stratumCount: 66 },
  { caseCount: 33, name: 'agent_eval_heldout_v1', stratumCount: 12 },
  { caseCount: 23, name: 'injection_g1_v1', stratumCount: 1 },
  { caseCount: 15, name: 'input_guard_v1', stratumCount: 1 },
  { caseCount: 13, name: 'long_context_v1', stratumCount: 1 },
  { caseCount: 5, name: 'phase1c_selection_v1', stratumCount: 1 },
];

/**
 * The case category each frozen set declares. `agent_eval_v3` also carries the
 * declaration in its migrated case metadata; the other five are frozen
 * exports that predate the schema, so the set is where their declaration
 * lives. A case whose own metadata names a different category is refused at
 * load rather than silently re-labelled.
 */
export const FROZEN_DATASET_CATEGORY: Readonly<Record<string, CaseCategory>> = {
  agent_eval_v3: 'end-to-end',
  agent_eval_heldout_v1: 'end-to-end',
  injection_g1_v1: 'safety',
  input_guard_v1: 'safety',
  long_context_v1: 'long-context',
  phase1c_selection_v1: 'prefix',
};

/**
 * The seven canonical sets beside `agent_eval_v3`, totalled: the sibling half
 * of the corpus the v3 source migration must not move. Not a seventh row of
 * the table above — two of the seven (`runtime_journey_v1`,
 * `translation_v1`) were never exported and own no freeze row.
 */
export const FROZEN_SIBLING_CASE_COUNT = 546;

/**
 * The frozen declaration for this name: its case and stratum counts.
 *
 * A typo is refused with the list rather than guessed at: it would otherwise
 * surface as ENOENT on a path nobody typed — and naming the six is what makes
 * the refusal actionable, so it lives here, where the six are declared.
 */
export function frozenDataset(name: string): FrozenDatasetCount {
  const set = FROZEN_DATASET_COUNTS.find((candidate) => candidate.name === name);
  if (set !== undefined) return set;
  const known = FROZEN_DATASET_COUNTS.map((candidate) => candidate.name);
  throw new RangeError(`unknown dataset "${name}" — one of: ${known.join(", ")}`);
}
