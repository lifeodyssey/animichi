import { HIDDEN_TOOL_STEPS, toolStepLabel } from "../i18n";
import type { ChatDict } from "../i18n";
import type { StepStatus } from "../tool-steps";

type Props = Readonly<{ type: string; status: StepStatus; dict: ChatDict }>;

/** The retried style is purely visual; name the state for assistive tech too. */
function ariaLabel(label: string, status: StepStatus, dict: ChatDict): string | undefined {
  if (status !== "retried") return undefined;
  return `${label} · ${dict.toolSteps.retried}`;
}

export function ToolStepBadge({ type, status, dict }: Props) {
  const name = type.replace(/^tool-/, "");
  if (HIDDEN_TOOL_STEPS.has(name)) return null;
  const label = toolStepLabel(dict, name);
  return (
    <span className="chat-step" data-status={status} data-tool={name} aria-label={ariaLabel(label, status, dict)}>
      {label}
    </span>
  );
}
