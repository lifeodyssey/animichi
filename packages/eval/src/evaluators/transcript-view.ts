/**
 * The seam between the evaluators and W3-2's wire transcript.
 *
 * The types below WERE a field-for-field copy, kept local only while
 * `card/1300-w3-2-eval-task` was not on this branch's base (#1313). It is now:
 * the copy is gone and `turn-transcript.ts` — the shaper that actually builds
 * these values — is the single declaration. Two identical types would have been
 * two places for the wire's shape to be described, and the one the evaluators
 * read is the one that must not drift.
 *
 * What the wire changes versus the Python originals, and why the ports here
 * read the way they do:
 *
 * - **There is no span tree, and no need for one.** Every call the stream
 *   publishes is a model-initiated tool call — deterministic bypasses and
 *   synthetic terminal steps emit no `tool-input-start` frame and no PydanticAI
 *   span either. So `trajectory` *is* the span tree, and `stepCount` is
 *   `len(AgentResult.steps)` for every turn the wire can describe.
 * - **`status` has three states.** `"unsettled"` means the call was made and
 *   the stream never said how it ended. The three ports that default to
 *   `include_failed=False` accept only `"ok"`; `MaxToolCalls` counts all three,
 *   because an unfinished call still spent the budget.
 * - **There is no `params`.** See `official-argument-correctness.ts` — that
 *   metric is degenerate on this type and the gap is real, not styling.
 */
export type {
  AnswerPart,
  RunStatus,
  StepStatus,
  TranscriptResult,
  TranscriptStep,
} from '../turn-transcript.ts';

import type { TranscriptResult, TranscriptStep } from '../turn-transcript.ts';

/**
 * The calls that did not fail — pydantic-evals' default `include_failed=False`,
 * used by `ToolCorrectness`, `TrajectoryMatch` and `ArgumentCorrectness`.
 * `"ok"` is `StepRecord.is_success` exactly.
 */
export function completedCalls(result: TranscriptResult): readonly TranscriptStep[] {
  return result.trajectory.filter((step) => step.status === 'ok');
}

export function toolNames(steps: readonly TranscriptStep[]): string[] {
  return steps.map((step) => step.toolName);
}
