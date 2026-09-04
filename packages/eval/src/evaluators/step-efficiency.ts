/**
 * `step_efficiency` — L2: ideal steps over actual steps, capped at 1.0, so the
 * metric only ever measures wasted steps.
 *
 * The case may accept several ideal counts (one per acceptable stage, plus
 * three special branches); the best of them wins. A turn with no steps at all
 * scores 1.0 — it wasted nothing. Ported from `StepEfficiency` in
 * `apps/agent/src/animichi/tests/eval/evaluators.py`, where the denominator is
 * `len(ctx.output.steps)`; on the wire that is `stepCount`.
 */

import { type AgentTurnContext, AgentTurnEvaluator, type MetricRecord } from './agent-evaluator.ts';
import { acceptableMinSteps } from './accepted-chains.ts';

export class StepEfficiency extends AgentTurnEvaluator {
  static override readonly evaluatorName = 'StepEfficiency';

  override evaluate(ctx: AgentTurnContext): MetricRecord {
    const actual = ctx.output.stepCount;
    if (actual === 0) {
      return { step_efficiency: 1 };
    }
    const minima = acceptableMinSteps(ctx.inputs, ctx.metadata, ctx.output);
    return { step_efficiency: Math.max(...minima.map((ideal) => Math.min(ideal / actual, 1))) };
  }
}
