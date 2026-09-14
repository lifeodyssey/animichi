import type { ChatStatus, UIMessage } from "ai";
import type { ChatDict } from "../i18n";
import { useTurnClock } from "../use-turn-clock";
import { waitingPhase } from "../waiting";
import type { WaitingPhase } from "../waiting";
import { waitingCopy } from "../waiting-copy";
import { TypingIndicator } from "./TypingIndicator";

type Props = Readonly<{ status: ChatStatus; dict: ChatDict; messages: readonly UIMessage[] }>;
export type WaitingFeedbackProps = Readonly<{ phase: WaitingPhase; dict: ChatDict }>;

/** Pure presentation lets stories show the long-wait state without waiting on a timer. */
export function WaitingFeedback({ phase, dict }: WaitingFeedbackProps) {
  const detail = phase === "extended" ? waitingCopy(dict.locale).extended : undefined;
  return <div className="mx-auto w-full min-w-0 max-w-[860px] py-1"><TypingIndicator dict={dict} detail={detail} /></div>;
}

function TimedWaiting({ dict }: Readonly<{ dict: ChatDict }>) {
  const elapsedMs = useTurnClock(true);
  return <WaitingFeedback phase={waitingPhase(elapsedMs)} dict={dict} />;
}

function userTurnId(messages: readonly UIMessage[]): string | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === "user") return message.id;
  }
  return undefined;
}

/** The user-message identity resets the delay; its text never implies a tool stage. */
export function WaitingRitual({ status, dict, messages }: Props) {
  if (status !== "submitted") return null;
  return <TimedWaiting key={userTurnId(messages)} dict={dict} />;
}
