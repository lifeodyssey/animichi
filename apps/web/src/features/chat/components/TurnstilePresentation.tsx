import { Button } from "animal-island-ui-tailwind/button";
import { useId } from "react";
import type { ReactNode } from "react";
import type { ChatDict } from "../i18n";

export type TurnstileView = "checking" | "interactive" | "verifying" | "failed";
type Props = Readonly<{ dict: ChatDict; state: TurnstileView; onRetry?: () => void; children?: ReactNode }>;
const ACTION = "[min-height:44px]! [height:auto]! [padding:9px_16px]! [font-size:14px]! [line-height:1.5]! [white-space:normal]! [--animal-text-color:var(--color-primary-strong)] [--animal-bg-color:var(--color-paper)] focus-visible:outline-primary-strong motion-reduce:[transition:none]!";

function VerificationMark({ failed }: Readonly<{ failed: boolean }>) {
  const tone = failed ? "bg-error-bg text-error-strong" : "bg-primary-soft text-primary-strong";
  return <span aria-hidden="true" className={`[display:grid] size-8 shrink-0 place-items-center rounded-full ${tone}`}><svg className="size-[18px]" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"><path d="m10 2 6 2.5V10c0 3.3-3.1 5.8-6 8-2.9-2.2-6-4.7-6-8V4.5Z" /><path d="M10 6.5v4M10 13.3v.2" /></svg></span>;
}

function viewCopy(dict: ChatDict, state: TurnstileView) {
  const copy = dict.turnstile;
  if (state === "failed") return { title: copy.failedTitle, body: copy.failed };
  if (state === "interactive") return { title: copy.interactiveTitle, body: copy.interactiveHint };
  if (state === "verifying") return { title: copy.verifyingTitle, body: copy.verifyingHint };
  return { title: copy.checkingTitle, body: copy.checkingHint };
}

/** The vendor owns the widget, branding and success mark. This frame never grants access. */
export function TurnstilePresentation({ dict, state, onRetry, children }: Props) {
  const descriptionId = useId(), copy = viewCopy(dict, state), failed = state === "failed";
  return <section className="turnstile-gate mx-auto grid w-full min-w-0 max-w-[420px] gap-4 rounded-3xl bg-paper p-5 text-sm leading-6 text-fg [overflow-wrap:anywhere]" aria-label={dict.turnstile.label} data-state={state}>
    <div className="grid grid-cols-[32px_minmax(0,1fr)] items-start gap-3"><VerificationMark failed={failed} /><div id={descriptionId} className="grid gap-1" role={failed ? "alert" : "status"} aria-atomic="true"><p className="text-base font-semibold">{copy.title}</p><p className="text-pretty text-muted-fg">{copy.body}</p></div></div>
    {children}
    {failed ? <div className="min-w-0"><Button htmlType="button" type="default" className={ACTION} onClick={onRetry} aria-describedby={descriptionId}>{dict.turnstile.retry}</Button></div> : null}
  </section>;
}
