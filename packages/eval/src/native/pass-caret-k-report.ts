import { ReportEvaluator, type ReportAnalysis, type ReportEvaluatorContext, type TableAnalysis } from 'logfire/evals';
import { objectOrNull } from '../json-object.ts';
import { passCaretKSummary, type PassCaretKCasePlan, type PassCaretKSummary } from './pass-caret-k.ts';

export const PASS_CARET_K_EVALUATOR_NAME = 'pass_caret_k';

/**
 * The native report evaluator: it reads the plan and k the run recorded in its
 * experiment metadata, records the verdict block machine-readably, and emits
 * the per-case table for the report reader. Missing run provenance is an
 * evaluator failure, never a guessed denominator.
 */
export class PassCaretK extends ReportEvaluator {
  static override evaluatorName = PASS_CARET_K_EVALUATOR_NAME;

  override evaluate(ctx: ReportEvaluatorContext): ReportAnalysis {
    const summary = passCaretKSummary(
      plannedCasesFromMetadata(ctx.experimentMetadata),
      ctx.report,
      repeatFromMetadata(ctx.experimentMetadata),
    );
    ctx.report.experiment_metadata = { ...ctx.report.experiment_metadata, pass_caret_k: blockOf(summary) };
    return tableOf(summary);
  }
}

/** The plan a run must record so an unstarted case cannot leave the denominator. */
export function plannedCasesFromMetadata(
  metadata: Readonly<Record<string, unknown>> | undefined,
): readonly PassCaretKCasePlan[] {
  const declared = metadata?.planned_cases;
  if (!Array.isArray(declared) || declared.length === 0) {
    throw new TypeError('pass^k requires experiment metadata.planned_cases: the planned case identities');
  }
  return declared.map((entry, index) => planCaseOf(entry, index));
}

/** The repeat count a run must record for pass^k to have a k at all. */
export function repeatFromMetadata(metadata: Readonly<Record<string, unknown>> | undefined): number {
  const repeat = metadata?.repeat;
  if (typeof repeat !== 'number' || !Number.isInteger(repeat) || repeat < 1) {
    throw new TypeError('pass^k requires experiment metadata.repeat: the positive integer repeat count');
  }
  return repeat;
}

/** The plan as a run records it in experiment metadata, one entry per case. */
export function recordedPlanCases(
  plan: readonly PassCaretKCasePlan[],
): readonly Readonly<Record<string, unknown>>[] {
  return plan.map((entry) => ({ name: entry.name, required_assertions: [...entry.requiredAssertions] }));
}

function blockOf(summary: PassCaretKSummary): Record<string, number> {
  return { k: summary.k, planned: summary.planned, passed: summary.passed, failed: summary.failed,
    incomplete: summary.incomplete, pass_rate: summary.passRate };
}

function tableOf(summary: PassCaretKSummary): TableAnalysis {
  return {
    type: 'table',
    title: `pass^${String(summary.k)}`,
    columns: ['case', 'attempts', 'verdict', 'passed_runs', 'reason'],
    rows: summary.cases.map((entry) => [entry.name, entry.attempts, entry.verdict, entry.passedRuns, entry.reason]),
  };
}

function planCaseOf(entry: unknown, index: number): PassCaretKCasePlan {
  const record = objectOrNull(entry);
  const required = record?.required_assertions;
  const name = requiredName(record?.name, index);
  if (!Array.isArray(required) || required.length === 0 || !required.every(isNonEmptyString)) {
    throw new TypeError(`experiment metadata.planned_cases[${String(index)}].required_assertions: expected names`);
  }
  return { name, requiredAssertions: required };
}

function requiredName(name: unknown, index: number): string {
  if (typeof name !== 'string' || name.trim() === '') {
    throw new TypeError(`experiment metadata.planned_cases[${String(index)}].name: expected a non-empty string`);
  }
  return name;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}
