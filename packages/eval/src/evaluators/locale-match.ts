/**
 * `locale_match` — L1: does the reply speak the language of the current turn?
 *
 * The expectation is derived from the user's own query, with the requested
 * locale only as a fallback; the reply is then resolved against that
 * expectation. An empty message scores 0.0 — silence matches nothing.
 * Ported from `LocaleMatch` in
 * `apps/agent/src/animichi/tests/eval/evaluators.py`.
 */

import { type AgentTurnContext, AgentTurnEvaluator, type MetricRecord } from './agent-evaluator.ts';
import { resolveReplyLanguage } from './reply-language.ts';

export class LocaleMatch extends AgentTurnEvaluator {
  static override readonly evaluatorName = 'LocaleMatch';

  override evaluate(ctx: AgentTurnContext): MetricRecord {
    const message = ctx.output.message;
    if (message === '') {
      return { locale_match: 0 };
    }
    const expected = resolveReplyLanguage(ctx.inputs.query, ctx.inputs.locale);
    return { locale_match: resolveReplyLanguage(message, expected) === expected ? 1 : 0 };
  }
}
