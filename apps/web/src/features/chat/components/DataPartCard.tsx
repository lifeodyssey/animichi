import type { ChatDataPart } from "@seichijunrei/contract";
import { isIntentOnly, parseChatDataPart } from "../data-parts";
import type { ChatDict } from "../i18n";
import { intentRegistry } from "../registry";

type CardProps = Readonly<{ data: unknown; dict: ChatDict }>;

function FallbackCard({ dict }: Readonly<{ dict: ChatDict }>) {
  return <p className="chat-card chat-card--fallback">{dict.fallbackCard}</p>;
}

function SkeletonCard({ part, dict }: Readonly<{ part: ChatDataPart; dict: ChatDict }>) {
  return (
    <p className="chat-card chat-card--skeleton" role="status" aria-busy="true" data-intent={part.intent}>
      {dict.preparing}
    </p>
  );
}

function IntentCard({ part, dict }: Readonly<{ part: ChatDataPart; dict: ChatDict }>) {
  const Body = intentRegistry[part.intent];
  return (
    <article className="chat-card" data-intent={part.intent}>
      {part.message ? <p className="chat-card__message">{part.message}</p> : null}
      <Body part={part} dict={dict} />
    </article>
  );
}

/**
 * Renderer for a streamed `data-response` part. The payload is validated at
 * this trust boundary; invalid parts get the fallback card, the intent-first
 * frame gets a skeleton, and full frames render through the intent registry.
 */
export function DataPartCard({ data, dict }: CardProps) {
  const part = parseChatDataPart(data);
  if (!part) return <FallbackCard dict={dict} />;
  if (isIntentOnly(part)) return <SkeletonCard part={part} dict={dict} />;
  return <IntentCard part={part} dict={dict} />;
}
