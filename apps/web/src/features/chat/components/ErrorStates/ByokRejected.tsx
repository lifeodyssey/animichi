import { Link } from "@tanstack/react-router";
import { useId } from "react";
import { BYOK_SETUP_HASH } from "../../byok-journey";
import { useChatSessionId } from "../../ChatReturnTarget";
import type { ChatDict } from "../../i18n";

type Props = Readonly<{ dict: ChatDict }>;
const ACTION = "chat-byok-rejected__open animal-btn animal-btn-default animal-btn-middle [min-height:44px]! [height:auto]! [padding:9px_16px]! [font-size:14px]! [line-height:1.5]! [white-space:normal]! [--animal-text-color:var(--color-primary-strong)] [--animal-bg-color:var(--color-paper)] focus-visible:outline-primary-strong motion-reduce:[transition:none]!";

function KeyMark() {
  return <span aria-hidden="true" className="mt-0.5 [display:grid] size-7 shrink-0 place-items-center rounded-full bg-error-bg text-error-strong">
    <svg className="size-4" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round"><circle cx="7" cy="7" r="3.75" /><path d="m9.7 9.7 6.8 6.8M12.5 12.5l2-2M14.5 14.5l2-2" /></svg>
  </span>;
}

function SettingsAction({ dict, descriptionId }: Props & Readonly<{ descriptionId: string }>) {
  const session = useChatSessionId();
  return <Link className={ACTION} to="/settings" search={{ session }} hash={BYOK_SETUP_HASH} aria-describedby={descriptionId}>
    {dict.byok.openSettings}
    <svg aria-hidden="true" className="size-4 shrink-0" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round"><path d="m8 5 5 5-5 5" /></svg>
  </Link>;
}

/** D14 only offers the settings destination: replaying the rejected key cannot repair it. */
export function ByokRejected({ dict }: Props) {
  const descriptionId = useId();
  return <div className="chat-byok-rejected grid min-w-0 grid-cols-[28px_minmax(0,1fr)] items-start gap-x-3 gap-y-3 py-1 text-sm leading-6 text-fg" data-state="D14">
    <KeyMark />
    <div id={descriptionId} role="alert" aria-atomic="true" className="grid min-w-0 gap-1 [overflow-wrap:anywhere]"><p className="font-semibold">{dict.byok.notAcceptedTitle}</p><p className="text-pretty text-muted-fg">{dict.byok.notAccepted}</p></div>
    <div className="col-start-2 min-w-0"><SettingsAction dict={dict} descriptionId={descriptionId} /></div>
  </div>;
}
