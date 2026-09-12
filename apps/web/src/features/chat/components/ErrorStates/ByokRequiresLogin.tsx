import { useId } from "react";
import type { ChatDict } from "../../i18n";
import { ByokSetupAction, ByokSetupFacts } from "../ByokSetupDetails";

function AccountMark() {
  return <span aria-hidden="true" className="mt-0.5 [display:grid] size-7 shrink-0 place-items-center rounded-full bg-primary-soft text-primary-strong">
    <svg className="size-4" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round"><circle cx="10" cy="6.5" r="2.75" /><path d="M4.5 16v-1a5.5 5.5 0 0 1 11 0v1" /></svg>
  </span>;
}

/** D13 explains the account requirement before the existing BYOK setup journey. */
export function ByokRequiresLogin({ dict }: Readonly<{ dict: ChatDict }>) {
  const byok = dict.byok, messageId = useId(), costId = `${messageId}-cost`;
  return <div className="chat-byok-gate grid min-w-0 grid-cols-[28px_minmax(0,1fr)] items-start gap-x-3 gap-y-4 py-1 text-sm leading-6 text-fg [overflow-wrap:anywhere]" data-state="D13">
    <AccountMark />
    <div id={messageId} className="chat-byok-gate__message grid min-w-0 gap-1" role="alert" aria-atomic="true"><p className="font-semibold">{byok.errorRequiresLogin}</p><p className="text-pretty text-muted-fg">{byok.upsellBenefit}</p></div>
    <div className="col-start-2 grid min-w-0 gap-4"><ByokSetupFacts byok={byok} costId={costId} /><ByokSetupAction byok={byok} describedBy={`${messageId} ${costId}`} /></div>
  </div>;
}
