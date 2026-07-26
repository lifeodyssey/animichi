import type { ChatErrorState } from "../../../../lib/chat/errorClassifier";
import type { ChatDict } from "../../i18n";
import { BudgetExhausted } from "./BudgetExhausted";
import { SessionExpired } from "./SessionExpired";
import { StreamInterruption, type InterruptionShape } from "./StreamInterruption";

export interface TurnFailureView {
  readonly state: ChatErrorState;
  readonly onRetry: () => void;
  readonly onExpiredResume: () => void;
  readonly recovering: boolean;
}

type Props = Readonly<{ view: TurnFailureView | undefined; dict: ChatDict }>;

function interruptionShape(state: ChatErrorState): InterruptionShape {
  if (state === "D5") return "D5";
  if (state === "D10") return "D10";
  return "D4";
}

/** Inline turn-failure surface: the D8/D11 login banners or the D4/D5/D10 retry strip. */
export function TurnFailure({ view, dict }: Props) {
  if (!view) return null;
  if (view.state === "D11") return <BudgetExhausted dict={dict} />;
  if (view.state === "D8") {
    return <SessionExpired dict={dict} onResume={view.onExpiredResume} recovering={view.recovering} />;
  }
  const shape = interruptionShape(view.state);
  return <StreamInterruption state={shape} dict={dict} onRetry={view.onRetry} recovering={view.recovering} />;
}
