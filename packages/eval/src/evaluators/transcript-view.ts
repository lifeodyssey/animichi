/**
 * The seam between the evaluators and W3-2's wire transcript.
 *
 * ON REBASE ONTO #1300: delete the declarations below and replace them with
 *
 *     export type { AnswerPart, StepStatus, TranscriptResult, TranscriptStep }
 *       from '../turn-transcript.ts';
 *
 * They are a field-for-field copy of `packages/eval/src/turn-transcript.ts`
 * @ 4c5b9104b, kept local only because `card/1300-w3-2-eval-task` is not on
 * this branch's base. Nothing else in `src/evaluators/` names these members, so
 * that one edit is the whole rebase.
 *
 * What the wire changes versus the Python originals, and why the ports below
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

export type StepStatus = 'error' | 'ok' | 'unsettled';

export interface TranscriptStep {
  readonly args: Readonly<Record<string, unknown>>;
  readonly status: StepStatus;
  readonly toolName: string;
}

/** The `data-response` part the turn ended with. */
export interface AnswerPart {
  readonly data: Readonly<Record<string, unknown>>;
  readonly intent: string;
  readonly message: string;
  readonly success: boolean;
}

export type RunStatus = 'failed' | 'running' | 'succeeded';

/** One turn as the evaluators read it — Python's `AgentResult`, off the wire. */
export interface TranscriptResult {
  /** `_available_data_keys`, already derived by the shaper from `response`. */
  readonly dataKeys: readonly string[];
  readonly intent: string;
  /** The locale the turn was REQUESTED with; the envelope publishes none. */
  readonly locale: string;
  readonly message: string;
  readonly response: AnswerPart | null;
  readonly runStatus: RunStatus | null;
  readonly stepCount: number;
  readonly success: boolean;
  readonly trajectory: readonly TranscriptStep[];
}

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
