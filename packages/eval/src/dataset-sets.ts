/**
 * The exported dataset sets and the case count each one must keep.
 *
 * The counts are a tripwire, not a derived value: a fixture that silently
 * shrinks (a truncated export, an `EVAL_MAX_CASES` leak into the exporter)
 * would otherwise still load and still deep-equal itself.
 *
 * Producer: `scripts/export-eval-fixtures.sh`, one `EVAL_DATASET` per set.
 */
export interface ExportedDataset {
  readonly caseCount: number;
  readonly name: string;
}

export const EXPORTED_DATASETS: readonly ExportedDataset[] = [
  { caseCount: 662, name: 'agent_eval_v3' },
  { caseCount: 33, name: 'agent_eval_heldout_v1' },
  { caseCount: 23, name: 'injection_g1_v1' },
  { caseCount: 15, name: 'input_guard_v1' },
  { caseCount: 13, name: 'long_context_v1' },
  { caseCount: 5, name: 'phase1c_selection_v1' },
];
