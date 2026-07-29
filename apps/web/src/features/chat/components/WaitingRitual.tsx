import type { ChatStatus, UIMessage } from "ai";
import type { ChatDict } from "../i18n";
import { pickMood } from "../mood";
import { useTurnClock } from "../use-turn-clock";
import { waitingPhase } from "../waiting";
import type { WaitingPhase } from "../waiting";
import { MoodCard } from "./MoodCard";
import { TypingIndicator } from "./TypingIndicator";

type Props = Readonly<{ status: ChatStatus; dict: ChatDict; messages: readonly UIMessage[] }>;

function lastUserText(messages: readonly UIMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message?.role !== "user") continue;
    return message.parts.map((part) => (part.type === "text" ? part.text : "")).join("");
  }
  return "";
}

function WaitingSubtitle({ dict }: Readonly<{ dict: ChatDict }>) {
  return <p className="chat-waiting__subtitle">{dict.waitingSubtitle}</p>;
}

type LayerProps = Readonly<{ phase: WaitingPhase; dict: ChatDict; messages: readonly UIMessage[] }>;

function WaitingLayers({ phase, dict, messages }: LayerProps) {
  return (
    <div className="chat-waiting">
      <TypingIndicator dict={dict} />
      {phase === "B2a" ? null : <WaitingSubtitle dict={dict} />}
      {phase === "B2c" ? <MoodCard mood={pickMood(lastUserText(messages))} /> : null}
    </div>
  );
}

/** B2a→B2c waiting ritual: fox typing, a fox subtitle, then a mood card. */
export function WaitingRitual({ status, dict, messages }: Props) {
  const active = status === "submitted";
  const elapsedMs = useTurnClock(active);
  if (!active) return null;
  return <WaitingLayers phase={waitingPhase(elapsedMs)} dict={dict} messages={messages} />;
}
