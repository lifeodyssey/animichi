/**
 * `data_keys_present` — L1: 1.0 when every data key the case expects is
 * actually present in the response payload.
 *
 * A case that expects no keys scores 1.0: there was nothing to withhold.
 * Ported from `DataKeysPresent` in
 * `apps/agent/src/animichi/tests/eval/evaluators.py`.
 *
 * `_available_data_keys` itself is not re-derived here. W3-2's shaper already
 * answers it off the published `data` (`turn-transcript.ts::dataKeysOf`) — the
 * same fact from the wire end rather than the session-registry end — so a
 * second port would be two implementations of one rule, drifting apart.
 * `fixtures/evaluator-oracle.json` carries Python's own `_available_data_keys`
 * as `dataKeys`, which is what holds the shaper to it.
 */

import { type AgentTurnContext, AgentTurnEvaluator, type MetricRecord } from './agent-evaluator.ts';

export class DataKeysPresent extends AgentTurnEvaluator {
  static override readonly evaluatorName = 'DataKeysPresent';

  override evaluate(ctx: AgentTurnContext): MetricRecord {
    const expected = ctx.metadata?.data_keys ?? [];
    if (expected.length === 0) {
      return { data_keys_present: 1 };
    }
    const available = new Set(ctx.output.dataKeys);
    return { data_keys_present: expected.every((key) => available.has(key)) ? 1 : 0 };
  }
}
