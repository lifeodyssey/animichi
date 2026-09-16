import { LLMJudge } from 'logfire/evals';
import type { JudgeFn } from 'logfire/evals';

/**
 * The report-only L3 judge.
 *
 * `LLMJudge` is the SDK's judge, but its default output is an *assertion* —
 * and an assertion is exactly what a verdict consumes, so a judge's absence or
 * timeout would veto a case that the domain evaluators passed. This factory
 * removes that coupling: `assertion: false` keeps the judge on the score
 * channel, which the pass^k statistic never reads, and the score is named
 * explicitly (`task_completion`, `hallucination_check`) so it stays distinct
 * from the named correctness assertions in the same report.
 *
 * A failing judge produces no value at all: the SDK records an
 * `evaluator_failure` for it, which is unmeasured evidence, never a fabricated
 * 0 or 1 and never a correctness veto.
 *
 * Two obligations this factory cannot enforce, and does not pretend to:
 * a rubric is boolean/classification (an official judge grades a named
 * criterion, not a 1–10 taste score), and judge numbers are not interpreted as
 * quality until the rubric is calibrated against human-labelled cases. This
 * card adds the mechanism; the calibration record belongs to the judge run.
 */
export function reportOnlyJudge(name: string, rubric: string, judge: JudgeFn): LLMJudge {
  const scoreName = nonEmpty(name, 'a judge name');
  const judgedRubric = nonEmpty(rubric, 'a judge rubric');
  const reportOnly = new LLMJudge({
    rubric: judgedRubric,
    judge,
    assertion: false,
    score: { includeReason: true },
  });
  // The SDK names a failed evaluator by `getResultName()`, so the judge's own
  // name is what a timeout or a bad callback is recorded under.
  reportOnly.evaluationName = scoreName;
  return reportOnly;
}

function nonEmpty(value: string, what: string): string {
  if (value.trim() === '') throw new TypeError(`${what} must be a non-empty string`);
  return value;
}
