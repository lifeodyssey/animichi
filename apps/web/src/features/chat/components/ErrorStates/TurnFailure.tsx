import type { ChatErrorState } from "../../../../lib/chat/errorClassifier";
import type { ChatDict } from "../../i18n";
import { SessionExpired } from "./SessionExpired";
import { StreamInterruption } from "./StreamInterruption";

export interface TurnFailureView {
  readonly state: ChatErrorState;
  readonly onRetry: () => void;
  readonly onExpiredResume: () => void;
  readonly recovering: boolean;
}

type Props = Readonly<{ view: TurnFailureView | undefined; dict: ChatDict }>;

/** Inline turn-failure surface: the D8 expiry banner or the D4/D5 retry strip. */
export function TurnFailure({ view, dict }: Props) {
  if (!view) return null;
  if (view.state === "D8") {
    return <SessionExpired dict={dict} onResume={view.onExpiredResume} recovering={view.recovering} />;
  }
  const shape = view.state === "D5" ? "D5" : "D4";
  return <StreamInterruption state={shape} dict={dict} onRetry={view.onRetry} recovering={view.recovering} />;
}
