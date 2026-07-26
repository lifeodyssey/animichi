import { HIDDEN_TOOL_STEPS, toolStepLabel } from "../i18n";
import type { ChatDict } from "../i18n";

export type StepStatus = "done" | "error" | "running";

/** Tool-part `state` machine → badge status (spec S1.1: step badges ← tool parts). */
export function stepStatus(state: string): StepStatus {
  if (state === "output-available") return "done";
  if (state === "output-error" || state === "output-denied") return "error";
  return "running";
}

type Props = Readonly<{ type: string; state: string; dict: ChatDict }>;

export function ToolStepBadge({ type, state, dict }: Props) {
  const name = type.replace(/^tool-/, "");
  if (HIDDEN_TOOL_STEPS.has(name)) return null;
  return (
    <span className="chat-step" data-status={stepStatus(state)} data-tool={name}>
      {toolStepLabel(dict, name)}
    </span>
  );
}
