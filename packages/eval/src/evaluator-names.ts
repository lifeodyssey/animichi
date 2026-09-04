/**
 * The evaluator names pydantic-evals serializes into every exported dataset
 * file. `logfire/evals` resolves each one through `FromOptions.customEvaluators`
 * and fails loudly on an unregistered name, so this list is the single place
 * the TS side declares what the Python export is allowed to contain.
 *
 * Python owners: `apps/agent/src/animichi/tests/eval/official_evaluators.py`
 * (the four official agentic adapters) and `evaluators.py` (the four
 * project-specific metrics). W3-3 implements them against these same names.
 */
export const EVALUATOR_NAMES = [
  'OfficialArgumentCorrectness',
  'OfficialToolCorrectness',
  'OfficialTrajectoryMatch',
  'OfficialMaxToolCalls',
  'DataKeysPresent',
  'LocaleMatch',
  'NonemptyResults',
  'StepEfficiency',
] as const;

export type EvaluatorName = (typeof EVALUATOR_NAMES)[number];
