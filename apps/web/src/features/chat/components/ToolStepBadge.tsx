import { HIDDEN_TOOL_STEPS, toolStepLabel } from "../i18n";
import type { ChatDict } from "../i18n";
import type { StepStatus } from "../tool-steps";

type Props = Readonly<{ type: string; status: StepStatus; dict: ChatDict }>;

/**
 * The retried state is otherwise conveyed by colour and `line-through` alone, so it
 * needs a text channel. `aria-label` is prohibited on generic elements (accname §4.3.1)
 * and `role="status"` would turn every badge into a live region, so append real text
 * that only sighted users have hidden from them.
 */
function RetriedNote({ status, dict }: Readonly<{ status: StepStatus; dict: ChatDict }>) {
  if (status !== "retried") return null;
  return <span className="chat-step__note"> {dict.toolSteps.retried}</span>;
}

export function ToolStepBadge({ type, status, dict }: Props) {
  const name = type.replace(/^tool-/, "");
  if (HIDDEN_TOOL_STEPS.has(name)) return null;
  return (
    <span className="chat-step" data-status={status} data-tool={name}>
      {toolStepLabel(dict, name)}
      <RetriedNote status={status} dict={dict} />
    </span>
  );
}
