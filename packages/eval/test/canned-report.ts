import type { EvaluationResultJson, ReportCase } from 'logfire/evals';

import type { ExportedAgentExpected, ExportedAgentInput } from '../src/dataset-roundtrip.ts';
import type { AgentEvalReport } from '../src/gate-run/gate-run-result.ts';
import type { TranscriptResult } from '../src/turn-transcript.ts';
import { makeAgentInput, makeTranscriptResult, type MetricRecord } from './gated-run.ts';

/**
 * A finished report, assembled rather than evaluated.
 *
 * `gated-run.ts` runs a real `Dataset.evaluate` with canned scores, which is
 * the better subject for anything about the gate. This exists for the one
 * thing that cannot be pinned that way: `task_duration` comes from
 * `logfire/evals`' own clock during an evaluate, and a test that asserted on it
 * would be asserting on how fast the machine happened to be.
 */

export interface CannedCaseSpec {
  readonly name: string;
  readonly scores: MetricRecord;
  readonly intent?: string;
  readonly locale?: string;
  readonly seconds?: number;
  /** Turns the case replays before the measured one; each is a submission. */
  readonly historyTurns?: number;
}

const DEFAULT_INTENT = 'search_nearby';
const DEFAULT_LOCALE = 'ja';

export function makeCannedCase(
  spec: CannedCaseSpec,
): ReportCase<ExportedAgentInput, TranscriptResult, ExportedAgentExpected> {
  const intent = spec.intent ?? DEFAULT_INTENT;
  const locale = spec.locale ?? DEFAULT_LOCALE;
  const seconds = spec.seconds ?? 0;
  return {
    assertions: {},
    attributes: {},
    evaluator_failures: [],
    inputs: makeAgentInput(intent, locale, spec.historyTurns ?? 0),
    labels: {},
    metadata: { acceptable_stages: [], data_keys: [], expect_nonempty: true },
    metrics: {},
    name: spec.name,
    output: makeTranscriptResult(intent, locale),
    scores: scoreResults(spec.scores),
    span_id: null,
    task_duration: seconds,
    total_duration: seconds,
    trace_id: null,
  };
}

export function makeCannedReport(specs: readonly CannedCaseSpec[]): AgentEvalReport {
  return {
    analyses: [],
    cases: specs.map(makeCannedCase),
    failures: [],
    name: 'canned',
    report_evaluator_failures: [],
    span_id: null,
    trace_id: null,
  };
}

function scoreResults(scores: MetricRecord): Record<string, EvaluationResultJson> {
  const results = Object.entries(scores).map(([name, value]) => [
    name,
    { name, reason: null, source: { name, arguments: null }, value },
  ]);
  return Object.fromEntries(results) as Record<string, EvaluationResultJson>;
}
