import type { ChatErrorStatesDict } from "../../error-states-i18n";
import type { ChatDict } from "../../i18n";
import { FallbackRetryButton } from "./FallbackRetryButton";

export type InterruptionShape = "D4" | "D5" | "D10" | "D15" | "D16" | "D17" | "D18";

type Props = Readonly<{
  state: InterruptionShape;
  dict: ChatDict;
  onRetry: () => void;
  recovering?: boolean;
  /** D18 only: the error code named by the honest-generic copy. */
  errorCode?: string;
}>;

interface InterruptionCopy { message: string; retry: string }

const COPY: Readonly<Record<InterruptionShape, (states: ChatErrorStatesDict) => InterruptionCopy>> = {
  D4: (states) => ({ message: states.d4Message, retry: states.d4Retry }),
  D5: (states) => ({ message: states.d5Message, retry: states.d5Retry }),
  D10: (states) => ({ message: states.d10Message, retry: states.d10Retry }),
  D15: (states) => ({ message: states.d15Message, retry: states.d15Retry }),
  D16: (states) => ({ message: states.d16Message, retry: states.d16Retry }),
  D17: (states) => ({ message: states.d17Message, retry: states.d17Retry }),
  D18: (states) => ({ message: states.d18Message, retry: states.d18Retry }),
};

/** D18 names its code so the report the user files matches the server log. */
function copyFor(state: InterruptionShape, dict: ChatDict, errorCode: string | undefined): InterruptionCopy {
  const copy = COPY[state](dict.errorStates);
  if (state !== "D18") return copy;
  return { ...copy, message: copy.message.replace("{code}", errorCode ?? "unknown") };
}

/**
 * D4/D5/D10 plus the honest admission states D15-D18 (W1 #1220): an inline
 * retry strip at the interruption point. Rendered content above it stays
 * mounted; what retry does is the caller's per-state recovery — resend the
 * failed step, or re-read the session's final state (P6 semantics).
 */
export function StreamInterruption({ state, dict, onRetry, recovering, errorCode }: Props) {
  const copy = copyFor(state, dict, errorCode);
  return (
    <div className="chat-interruption" role="alert" data-state={state}>
      <span>{copy.message}</span>
      <FallbackRetryButton label={copy.retry} onClick={onRetry} disabled={recovering} className="chat-interruption__retry" />
    </div>
  );
}
