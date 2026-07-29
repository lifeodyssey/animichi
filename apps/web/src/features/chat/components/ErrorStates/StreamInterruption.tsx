import type { ChatDict } from "../../i18n";
import { FallbackRetryButton } from "./FallbackRetryButton";

export type InterruptionShape = "D4" | "D5" | "D10";

type Props = Readonly<{
  state: InterruptionShape;
  dict: ChatDict;
  onRetry: () => void;
  recovering?: boolean;
}>;

function copyFor(state: InterruptionShape, dict: ChatDict): { message: string; retry: string } {
  const states = dict.errorStates;
  if (state === "D5") return { message: states.d5Message, retry: states.d5Retry };
  if (state === "D10") return { message: states.d10Message, retry: states.d10Retry };
  return { message: states.d4Message, retry: states.d4Retry };
}

/**
 * D4/D5/D10: an inline retry strip at the interruption point. Rendered content
 * above it stays mounted; retry re-fetches the session's final state instead
 * of resuming the broken stream (P6 disconnect-recovery semantics).
 */
export function StreamInterruption({ state, dict, onRetry, recovering }: Props) {
  const copy = copyFor(state, dict);
  return (
    <div className="chat-interruption" role="alert" data-state={state}>
      <span>{copy.message}</span>
      <FallbackRetryButton label={copy.retry} onClick={onRetry} disabled={recovering} className="chat-interruption__retry" />
    </div>
  );
}
