/**
 * `nonempty_results` — L1: a case tagged `expect_nonempty` must come back with
 * at least one catalog row behind whatever it produced. Untagged cases return
 * `{}` — the metric does not apply.
 *
 * Ported from `NonemptyResults` / `_nonempty` in
 * `apps/agent/src/animichi/tests/eval/evaluators.py`, with one substitution
 * forced by the wire: Python follows the produced itinerary's `source_ref` back
 * into the session's search registry and reads *that* entry's `row_count`,
 * and the stream carries no ref to follow. The published `results` stands in
 * for it — a routed turn publishes the search it was routed from. Both of
 * Python's failure branches (no `source_ref`, and a `source_ref` that misses the
 * registry) land on the same observable here: no `results` in `data`.
 */

import { type AgentTurnContext, AgentTurnEvaluator, type MetricRecord } from './agent-evaluator.ts';
import type { TranscriptResult } from './transcript-view.ts';

export class NonemptyResults extends AgentTurnEvaluator {
  static override readonly evaluatorName = 'NonemptyResults';

  override evaluate(ctx: AgentTurnContext): MetricRecord {
    if (ctx.metadata?.expect_nonempty !== true) {
      return {};
    }
    return { nonempty_results: hasRows(ctx.output) ? 1 : 0 };
  }
}

function hasRows(result: TranscriptResult): boolean {
  const data = result.response?.data;
  if (data === undefined) {
    return false;
  }
  const sourceRows = rowCount(data.results);
  return 'itinerary' in data ? orderedPointCount(data.itinerary) > 0 && sourceRows > 0 : sourceRows > 0;
}

function rowCount(results: unknown): number {
  const value = asRecord(results)?.row_count;
  return typeof value === 'number' ? value : 0;
}

function orderedPointCount(itinerary: unknown): number {
  const points = asRecord(itinerary)?.ordered_points;
  return Array.isArray(points) ? points.length : 0;
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : null;
}
