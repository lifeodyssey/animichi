import type { ChatDataPart } from "@animichi/contract";
import type { ChatDict } from "../i18n";
import { skeletonCopy, skeletonLabel } from "../skeleton-copy";
import { TypingIndicator } from "./TypingIndicator";

type Props = Readonly<{ intent: ChatDataPart["intent"]; dict: ChatDict; pending: boolean }>;

function IncompleteMark() {
  return <span aria-hidden="true" className="mt-0.5 [display:grid] size-7 shrink-0 place-items-center rounded-full bg-muted text-muted-fg">
    <svg className="size-4" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"><path d="M11.5 2.5H5a1 1 0 0 0-1 1v13a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V7l-4.5-4.5ZM11 3v5h5M7.5 12h5" /></svg>
  </span>;
}

function IncompleteContent({ dict }: Readonly<{ dict: ChatDict }>) {
  return <div className="[display:flex] min-h-10 min-w-0 items-start gap-3" role="status" aria-live="polite" aria-atomic="true">
    <IncompleteMark />
    <p className="min-w-0 pt-0.5 text-sm font-medium leading-6 text-muted-fg [overflow-wrap:anywhere]">{skeletonCopy(dict.locale).incomplete}</p>
  </div>;
}

/** Keep the live announcement outside a busy region so it can be heard while receiving. */
export function SkeletonCard({ intent, dict, pending }: Props) {
  const stateClass = pending ? "chat-card--skeleton" : "chat-card--incomplete";
  return <div className={`${stateClass} w-full min-w-0 py-1`} data-intent={pending ? intent : undefined}>
    {pending ? <TypingIndicator dict={dict} label={skeletonLabel(intent, dict.locale)} /> : <IncompleteContent dict={dict} />}
  </div>;
}
