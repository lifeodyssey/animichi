/**
 * `argument_correctness` — pydantic-evals'
 * `ArgumentCorrectness(match_mode='exact')`, run once per successful call and
 * reduced with `min`.
 *
 * Formula (`pydantic_evals/evaluators/agentic.py`): find the calls to the named
 * tool, pick the requested 0-based occurrence, and compare its recorded
 * arguments with the expected ones — `'exact'` fails on a missing key, an
 * unequal value, or an unexpected key, i.e. deep equality. A tool that was
 * never called, an occurrence out of range, and unrecorded arguments all score
 * 0.0 rather than passing vacuously. A turn with no successful call returns
 * `{}` — no metric, not a zero.
 *
 * ⚠️ **THIS METRIC IS DEGENERATE ON THE WIRE TRANSCRIPT — DO NOT READ IT AS A
 * PASSING SCORE.** Python compares two independently recorded things: the raw
 * arguments on the tool's span, against `StepRecord.params`, the normalized
 * arguments the runner recorded for the same call
 * (`official_evaluators.py::OfficialArgumentCorrectness`). The SD-9 stream
 * publishes only the first — `tool-input-available` carries one `input` record
 * per call and there is no second, independent witness to disagree with it. So
 * every settled call trivially matches itself and this can only ever return
 * `1.0` or `{}`.
 *
 * What still discriminates, and is therefore worth keeping wired: a call that
 * failed or never settled is excluded, so a turn made only of those returns
 * `{}`. What does not: a call whose arguments were never published arrives as
 * `args: {}`, indistinguishable from a genuine zero-argument call — the exact
 * ambiguity `StepRecord.params_recorded` exists to flag (#443).
 *
 * The fix is one additive member on `TranscriptStep` — the normalized params,
 * published alongside the raw input — which is #1300's call to make, not this
 * card's. Until then, treat `argument_correctness` as unmeasured.
 */

import { type AgentTurnContext, AgentTurnEvaluator, type MetricRecord } from './agent-evaluator.ts';
import { type TranscriptStep, completedCalls } from './transcript-view.ts';

export class OfficialArgumentCorrectness extends AgentTurnEvaluator {
  static override readonly evaluatorName = 'OfficialArgumentCorrectness';

  override evaluate(ctx: AgentTurnContext): MetricRecord {
    const scores = completedCalls(ctx.output).map(publishedArgumentsMatch);
    return scores.length === 0 ? {} : { argument_correctness: Math.min(...scores) };
  }
}

/**
 * The whole of what the wire can judge: the call published the arguments it was
 * made with. Restore the real comparison here once a step carries its
 * normalized params next to its raw input.
 */
function publishedArgumentsMatch(_step: TranscriptStep): number {
  return 1;
}
