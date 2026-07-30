export type StepStatus = "done" | "error" | "retried" | "running";

export interface ToolStep {
  readonly type: string;
  readonly state: string;
  readonly input?: unknown;
}

export interface StatusedStep<T extends ToolStep> {
  readonly step: T;
  readonly status: StepStatus;
}

/** Tool-part `state` machine → badge status (spec S1.1: step badges ← tool parts). */
export function stepStatus(state: string): StepStatus {
  if (state === "output-available") return "done";
  if (state === "output-error" || state === "output-denied") return "error";
  return "running";
}

/**
 * A `ModelRetry` closes the in-flight tool part as an error and re-issues the same
 * tool under a fresh call id, so a turn that ultimately succeeds still carries the
 * failed part. Such a superseded step is `retried`, not `error`.
 */
export function statusedSteps<T extends ToolStep>(steps: readonly T[]): StatusedStep<T>[] {
  return steps.map((step, index) => ({ step, status: resolve(step, steps.slice(index + 1)) }));
}

/**
 * Only `output-error` is demotable. `output-denied` records a refusal the user
 * themselves made; restyling it as "retried" would report "we re-ran it" where
 * the truth is "you refused and the agent went around it".
 */
function resolve(step: ToolStep, later: readonly ToolStep[]): StepStatus {
  if (step.state !== "output-error") return stepStatus(step.state);
  return later.some((next) => next.type === step.type && sameInput(step, next)) ? "retried" : "error";
}

function sameInput(left: ToolStep, right: ToolStep): boolean {
  return JSON.stringify(left.input) === JSON.stringify(right.input);
}
