import type { ChatDict } from "../i18n";
import { FoxAvatar } from "./FoxAvatar";

type Props = Readonly<{ dict: ChatDict }>;

function TypingDots() {
  return (
    <span className="chat-typing__dots" aria-hidden="true">
      <span className="chat-typing__dot" />
      <span className="chat-typing__dot" />
      <span className="chat-typing__dot" />
    </span>
  );
}

/** B2a running <1s: fox avatar + three bouncing dots (states spec). */
export function TypingIndicator({ dict }: Props) {
  return (
    <div className="chat-typing" role="status" aria-label={dict.thinking}>
      <FoxAvatar pose="thinking" alt="" />
      <TypingDots />
    </div>
  );
}
