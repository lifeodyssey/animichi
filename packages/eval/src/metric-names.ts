/**
 * The metric names a run reports, in the order Python reports them.
 *
 * Order matters: the baseline files, the gate, and the report tables are all
 * keyed positionally off this list, so the TS runner has to agree with
 * `eval_harness.metric_names` name for name and slot for slot. The committed
 * dump in `fixtures/evaluator-oracle.json` is what proves it.
 *
 * `nonempty_results` drops out when the dataset carries no `expect_nonempty`
 * case — the evaluator returns `{}` for every case, so a column would be
 * permanently empty rather than zero.
 */

const OFFICIAL_METRIC_NAMES: readonly string[] = [
  'argument_correctness',
  'tool_correctness',
  'trajectory_match',
  'max_tool_calls',
];

const KEPT_METRIC_NAMES: readonly string[] = [
  'data_keys_present',
  'locale_match',
  'nonempty_results',
  'step_efficiency',
];

/** The L3 outcome judges, appended only when `EVAL_L3` opts them in. */
const L3_METRIC_NAMES: readonly string[] = ['task_completion', 'hallucination_check'];

export interface MetricNameOptions {
  readonly hasNonemptyCases: boolean;
  readonly l3Enabled: boolean;
}

export function metricNames({ hasNonemptyCases, l3Enabled }: MetricNameOptions): string[] {
  const kept = KEPT_METRIC_NAMES.filter(
    (name) => name !== 'nonempty_results' || hasNonemptyCases,
  );
  const names = [...OFFICIAL_METRIC_NAMES, ...kept];
  return l3Enabled ? [...names, ...L3_METRIC_NAMES] : names;
}
