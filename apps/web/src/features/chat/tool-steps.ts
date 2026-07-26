export type StepStatus = "done" | "error" | "retried" | "running";

export interface ToolStep {
  readonly type: string;
  readonly state: string;
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

function resolve(step: ToolStep, later: readonly ToolStep[]): StepStatus {
  const status = stepStatus(step.state);
  if (status !== "error") return status;
  return later.some((next) => next.type === step.type) ? "retried" : "error";
}
