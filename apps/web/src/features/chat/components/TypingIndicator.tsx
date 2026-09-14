import type { ChatDict } from "../i18n";
import { waitingCopy } from "../waiting-copy";

type Props = Readonly<{ dict: ChatDict; label?: string; detail?: string }>;

function WaitingMark() {
  return <span className="mt-0.5 [display:grid] size-7 shrink-0 place-items-center rounded-full bg-primary-soft" aria-hidden="true">
    <span className="size-3.5 rounded-full border-2 border-primary/25 border-t-primary-strong motion-safe:animate-spin motion-safe:[animation-duration:1.4s] motion-reduce:animate-none" />
  </span>;
}

/** One polite announcement; decorative motion never supplies progress information. */
export function TypingIndicator({ dict, label = waitingCopy(dict.locale).label, detail }: Props) {
  return <div className="[display:flex] min-h-10 w-full min-w-0 items-start gap-3 text-fg" role="status" aria-live="polite" aria-atomic="true">
    <WaitingMark />
    <span className="[display:flex] min-w-0 flex-col gap-1 pt-0.5 [overflow-wrap:anywhere]">
      <span className="text-sm font-medium leading-6">{label}</span>
      {detail ? <span className="text-sm leading-6 text-muted-fg">{detail}</span> : null}
    </span>
  </div>;
}
