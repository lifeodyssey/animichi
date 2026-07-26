import type { ChatDataPart } from "@seichijunrei/contract";
import type { ReactNode } from "react";
import { classifyFailure } from "../../../lib/chat/errorClassifier";
import type { ChatErrorState } from "../../../lib/chat/errorClassifier";
import { isIntentOnly, parseChatDataPart } from "../data-parts";
import type { ChatDict } from "../i18n";
import { intentRegistry } from "../registry";
import { EnvelopeFallback } from "./ErrorStates/EnvelopeFallback";
import { ShortRouteNotice } from "./ErrorStates/ShortRouteNotice";

type CardProps = Readonly<{ data: unknown; dict: ChatDict; superseded?: boolean }>;
type PartProps = Readonly<{ part: ChatDataPart; dict: ChatDict; superseded?: boolean }>;
type IntentProps = PartProps & Readonly<{ appendix?: ReactNode }>;

function FallbackCard({ dict }: Readonly<{ dict: ChatDict }>) {
  return <p className="chat-card chat-card--fallback">{dict.fallbackCard}</p>;
}

function SkeletonCard({ part, dict }: PartProps) {
  return (
    <p className="chat-card chat-card--skeleton" role="status" aria-busy="true" data-intent={part.intent}>
      {dict.preparing}
    </p>
  );
}

/** E1: a superseded living-document card dims and wears the version badge. */
function cardClass(superseded: boolean | undefined): string {
  return superseded === true ? "chat-card chat-card--superseded" : "chat-card";
}

function VersionBadge({ dict }: Readonly<{ dict: ChatDict }>) {
  return <span className="chat-card__version-badge">{dict.previousVersion}</span>;
}

function CardMessage({ part }: Readonly<{ part: ChatDataPart }>) {
  if (!part.message) return null;
  return <p className="chat-card__message">{part.message}</p>;
}

function CardBadge({ dict, superseded }: Readonly<{ dict: ChatDict; superseded?: boolean }>) {
  if (superseded !== true) return null;
  return <VersionBadge dict={dict} />;
}

function IntentCard({ part, dict, appendix, superseded }: IntentProps) {
  const Body = intentRegistry[part.intent];
  return (
    <article className={cardClass(superseded)} data-intent={part.intent}>
      <CardBadge dict={dict} superseded={superseded} />
      <CardMessage part={part} />
      <Body part={part} dict={dict} />{appendix}
    </article>
  );
}

type SettledProps = PartProps & Readonly<{ state: ChatErrorState | undefined }>;

/**
 * Settled envelopes classify first (issue #272 §D): a D-state renders its
 * in-character fallback instead of — or for D3, alongside — the intent card.
 */
function SettledCard({ part, dict, state, superseded }: SettledProps) {
  const d3 = state === "D3" ? <ShortRouteNotice dict={dict} /> : undefined;
  if (state !== undefined && state !== "D3") return <EnvelopeFallback state={state} dict={dict} />;
  return <IntentCard part={part} dict={dict} appendix={d3} superseded={superseded} />;
}

/**
 * Renderer for a streamed `data-response` part. The payload is validated at
 * this trust boundary; invalid parts get the fallback card and full frames
 * classify then render. A skeleton covers intent-first frames — except failed
 * intents, whose fallback shows immediately (an error never wears a skeleton).
 */
export function DataPartCard({ data, dict, superseded }: CardProps) {
  const part = parseChatDataPart(data);
  if (!part) return <FallbackCard dict={dict} />;
  const state = classifyFailure({ kind: "envelope", part });
  if (isIntentOnly(part) && state === undefined) return <SkeletonCard part={part} dict={dict} />;
  return <SettledCard part={part} dict={dict} state={state} superseded={superseded} />;
}
