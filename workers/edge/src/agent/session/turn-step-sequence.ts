/**
 * The numbering of one run's tool steps (card #1252).
 *
 * `(run_id, step_index)` is the idempotency key of the whole turn machinery
 * (spec §三 "工具步骤幂等"), so what the numbers MEAN is a concept of its own,
 * separate from what a step does with them: which index comes next, what is
 * already settled under an index, and which assistant message opened one.
 *
 * The counter starts where the REBUILT TRANSCRIPT stopped (#1279). The k-th
 * tool call of the run is step k on the first attempt and on every later one —
 * which is what makes the key an idempotency key rather than a log line — and
 * a retry reaches that in one of two ways. A settled step whose call the
 * transcript already answers is never asked for again, so the counter must
 * start past it; a settled step under a dropped assistant message is asked for
 * again and replayed in place. `resumedTranscript` is what tells the two apart,
 * because it is the walk that decides which rows survive.
 */
import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { LoadedTurn, StepResult, ToolCallEnvelope } from "./turn-store.ts";

export class StepSequence {
  readonly #turn: LoadedTurn;
  #next: number;
  #openedBy: AssistantMessage | null = null;

  /** `resumedSteps` is how many of this run's settled steps the transcript the
   * loop resumes from already answers. */
  constructor(turn: LoadedTurn, resumedSteps: number) {
    this.#turn = turn;
    this.#next = resumedSteps;
  }

  /** The index of the step about to be resolved. */
  take(): number {
    const stepIndex = this.#next;
    this.#next += 1;
    return stepIndex;
  }

  /** The result already persisted for this index, or null when there is none. */
  settled(stepIndex: number): StepResult | null {
    return this.#turn.steps.find((step) => step.stepIndex === stepIndex)?.result ?? null;
  }

  /** The issuing assistant message, claimed once — by the FIRST step it opens. */
  opening(stepIndex: number, message: AssistantMessage | null): ToolCallEnvelope | null {
    if (message === null || message === this.#openedBy) return null;
    this.#openedBy = message;
    return { run_id: this.#turn.runId, step_index: stepIndex, message };
  }
}
