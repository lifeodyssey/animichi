export type StepStatus = "done" | "error" | "running";

/** Tool-part `state` machine → badge status (spec S1.1: step badges ← tool parts). */
export function stepStatus(state: string): StepStatus {
  if (state === "output-available") return "done";
  if (state === "output-error" || state === "output-denied") return "error";
  return "running";
}

type Props = Readonly<{ type: string; state: string }>;

export function ToolStepBadge({ type, state }: Props) {
  const name = type.replace(/^tool-/, "");
  return (
    <span className="chat-step" data-status={stepStatus(state)} data-tool={name}>
      {name}
    </span>
  );
}
