import { HIDDEN_TOOL_STEPS, toolStepLabel } from "../i18n";
import type { ChatDict } from "../i18n";
import type { StepStatus } from "../tool-steps";
import { ProgressGlyph } from "./ProgressGlyph";

type Props = Readonly<{ type: string; status: StepStatus; dict: ChatDict }>;

const STEP_CLASS = "chat-step [display:flex] min-h-8 min-w-0 items-center gap-2 text-sm font-medium leading-6 text-ground-ink data-[status=error]:w-fit data-[status=error]:rounded-lg data-[status=error]:bg-error-bg data-[status=error]:px-2 data-[status=error]:text-error-strong";

function StatusNote({ status, dict }: Readonly<{ status: StepStatus; dict: ChatDict }>) {
  if (status === "running") return null;
  const labels = { done: dict.toolSteps.done, error: dict.toolSteps.failed, retried: dict.toolSteps.retried };
  const classes = status === "done" ? "sr-only" : "font-normal";
  return <span className={`chat-step__note ${classes}`}> {labels[status]}</span>;
}

export function ToolStepBadge({ type, status, dict }: Props) {
  const name = type.replace(/^tool-/, "");
  if (HIDDEN_TOOL_STEPS.has(name)) return null;
  return (
    <span className={STEP_CLASS} data-status={status} data-tool={name}>
      <ProgressGlyph kind={status} />
      <span className="min-w-0 [overflow-wrap:anywhere]">{toolStepLabel(dict, name, status)}<StatusNote status={status} dict={dict} /></span>
    </span>
  );
}
