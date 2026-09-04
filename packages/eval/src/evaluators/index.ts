/**
 * The eight evaluators, in the order the Python exporter serializes them.
 *
 * Registration key = `static evaluatorName`, which must equal the name in the
 * exported dataset file; `src/evaluator-names.ts` is the list both sides agree
 * on and `test/evaluator-registration.test.ts` is the tripwire.
 */

import type { EvaluatorClass } from 'logfire/evals';

import { DataKeysPresent } from './data-keys-present.ts';
import { LocaleMatch } from './locale-match.ts';
import { NonemptyResults } from './nonempty-results.ts';
import { OfficialArgumentCorrectness } from './official-argument-correctness.ts';
import { OfficialMaxToolCalls } from './official-max-tool-calls.ts';
import { OfficialToolCorrectness } from './official-tool-correctness.ts';
import { OfficialTrajectoryMatch } from './official-trajectory-match.ts';
import { StepEfficiency } from './step-efficiency.ts';

import type { AgentTurnEvaluator } from './agent-evaluator.ts';

export { AgentTurnEvaluator, EVALUATOR_VERSION } from './agent-evaluator.ts';
export type { AgentTurnContext, MetricRecord } from './agent-evaluator.ts';
export type {
  AnswerPart,
  RunStatus,
  StepStatus,
  TranscriptResult,
  TranscriptStep,
} from './transcript-view.ts';
export {
  DataKeysPresent,
  LocaleMatch,
  NonemptyResults,
  OfficialArgumentCorrectness,
  OfficialMaxToolCalls,
  OfficialToolCorrectness,
  OfficialTrajectoryMatch,
  StepEfficiency,
};

const AGENT_EVALUATOR_CLASSES = [
  OfficialArgumentCorrectness,
  OfficialToolCorrectness,
  OfficialTrajectoryMatch,
  OfficialMaxToolCalls,
  DataKeysPresent,
  LocaleMatch,
  NonemptyResults,
  StepEfficiency,
] as const;

/** What `Dataset.fromFile` resolves the exported names against. */
export const AGENT_EVALUATORS: readonly EvaluatorClass[] = AGENT_EVALUATOR_CLASSES;

/** One fresh instance each — the port of `eval_harness.build_evaluators()`. */
export function buildAgentEvaluators(): AgentTurnEvaluator[] {
  return AGENT_EVALUATOR_CLASSES.map((Declared) => new Declared());
}
