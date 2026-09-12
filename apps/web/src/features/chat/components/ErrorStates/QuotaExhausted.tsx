import { Button } from "animal-island-ui-tailwind/button";
import { useId, useState } from "react";
import type { Locale } from "../../../../i18n/locales";
import { LoginModal } from "../../../auth/ui/LoginModal";
import { useChatReturnTarget } from "../../ChatReturnTarget";
import type { ChatDict } from "../../i18n";

type Props = Readonly<{ dict: ChatDict; locale: Locale; resetsAtMs: number | undefined }>;

/** The id a quota-locked composer points its `aria-describedby` at. */
export const QUOTA_BANNER_ID = "chat-quota-exhausted-banner";

/**
 * Include the local calendar date so an overnight reset is unambiguous.
 * No relative-day label or countdown can become stale while the notice is open.
 */
export function quotaNotice(dict: ChatDict, locale: Locale, resetsAtMs: number | undefined): string {
  if (resetsAtMs === undefined || !Number.isFinite(new Date(resetsAtMs).getTime())) return dict.errorStates.d12Message;
  const time = new Intl.DateTimeFormat(locale, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(resetsAtMs);
  return dict.errorStates.d12MessageAt.replace("{time}", time);
}

const ACTION = "chat-quota-exhausted__login [min-height:44px]! [height:auto]! [padding:9px_16px]! [font-size:14px]! [line-height:1.5]! [white-space:normal]! [--animal-text-color:var(--color-primary-strong)] [--animal-bg-color:var(--color-paper)] focus-visible:outline-primary-strong motion-reduce:[transition:none]!";

function QuotaMark() {
  return <span aria-hidden="true" className="mt-0.5 [display:grid] size-7 shrink-0 place-items-center rounded-full bg-gold-soft text-fg">
    <svg className="size-4" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round"><circle cx="10" cy="10" r="6.5" /><path d="M10 6.5V10l2.5 1.5" /></svg>
  </span>;
}

function QuotaNotice({ dict, locale, resetsAtMs, onLogin }: Props & Readonly<{ onLogin: () => void }>) {
  const descriptionId = useId();
  return <div id={QUOTA_BANNER_ID} className="chat-quota-exhausted grid min-w-0 grid-cols-[28px_minmax(0,1fr)] items-start gap-x-3 gap-y-3 py-1 text-sm leading-6 text-fg" role="status" aria-atomic="true">
    <QuotaMark />
    <div id={descriptionId} className="grid min-w-0 gap-1 [overflow-wrap:anywhere]"><p className="font-semibold">{dict.errorStates.d12Title}</p><p className="text-pretty text-muted-fg">{quotaNotice(dict, locale, resetsAtMs)}</p></div>
    <div className="col-start-2 min-w-0"><Button htmlType="button" type="default" className={ACTION} onClick={onLogin} aria-describedby={descriptionId} aria-haspopup="dialog">{dict.errorStates.d12Login}</Button></div>
  </div>;
}

/** D12 is a waiting state. Authentication and timed quota release remain with
 * the caller; opening the dialog or dispatching mail does not unlock sending. */
export function QuotaExhausted(props: Props) {
  const [open, setOpen] = useState(false);
  return <>
    <QuotaNotice {...props} onLogin={() => { setOpen(true); }} />
    <LoginModal open={open} onClose={() => { setOpen(false); }} returnTarget={useChatReturnTarget()} />
  </>;
}
