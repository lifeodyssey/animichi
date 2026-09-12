import { Button } from "animal-island-ui-tailwind/button";
import { useId, useState } from "react";
import { LoginModal } from "../../../auth/ui/LoginModal";
import { useChatReturnTarget } from "../../ChatReturnTarget";
import { useLoginDisclosure } from "../../byok-journey";
import type { ChatDict } from "../../i18n";
import { ByokUpsell } from "../ByokUpsell";

type Props = Readonly<{ dict: ChatDict }>;
type NoticeProps = Props & Readonly<{ onLogin: () => void; expanded: boolean; onToggle: () => void; detailsId: string }>;

const ACTION = "[min-height:44px]! [height:auto]! [font-size:14px]! [line-height:1.5]! [white-space:normal]! focus-visible:outline-primary-strong motion-reduce:[transition:none]!";
const LOGIN = `${ACTION} chat-budget-exhausted__login [padding:9px_16px]! [--animal-text-color:var(--color-primary-strong)] [--animal-bg-color:var(--color-paper)]`;
const DISCLOSURE = `${ACTION} chat-budget-exhausted__byok [padding:9px_4px]! [font-weight:500]! [--animal-text-color:var(--color-muted-fg)]`;

function BudgetMark() {
  return <span aria-hidden="true" className="mt-0.5 [display:grid] size-7 shrink-0 place-items-center rounded-full bg-gold-soft text-fg">
    <svg className="size-4" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round"><circle cx="10" cy="10" r="6.5" /><path d="M8 7.5v5m4-5v5" /></svg>
  </span>;
}

function DisclosureLabel({ dict, expanded }: Props & Readonly<{ expanded: boolean }>) {
  return <span className="inline-flex items-center gap-1.5 text-left">
    <span>{dict.byok.d11UseOwnKey}</span>
    <svg aria-hidden="true" className={`size-3 shrink-0 ${expanded ? "rotate-180" : ""}`} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round"><path d="m4 6 4 4 4-4" /></svg>
  </span>;
}

function BudgetActions({ dict, onLogin, expanded, onToggle, detailsId, descriptionId }: NoticeProps & Readonly<{ descriptionId: string }>) {
  return <div className="col-start-2 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
    <Button htmlType="button" type="default" className={LOGIN} onClick={onLogin} aria-describedby={descriptionId} aria-haspopup="dialog">{dict.errorStates.d11Login}</Button>
    <Button htmlType="button" type="text" className={DISCLOSURE} onClick={onToggle} aria-expanded={expanded} aria-controls={detailsId}><DisclosureLabel dict={dict} expanded={expanded} /></Button>
  </div>;
}

function BudgetNotice(props: NoticeProps) {
  const descriptionId = useId(), copy = props.dict.errorStates;
  return <div className="grid min-w-0 grid-cols-[28px_minmax(0,1fr)] items-start gap-x-3 gap-y-3 text-sm leading-6 text-fg">
    <BudgetMark />
    <div id={descriptionId} role="status" aria-atomic="true" className="grid min-w-0 gap-1 [overflow-wrap:anywhere]"><p className="font-semibold">{copy.d11Title}</p><p className="text-pretty text-muted-fg">{copy.d11Message}</p></div>
    <BudgetActions {...props} descriptionId={descriptionId} />
  </div>;
}

/** D11 closes the shared guest allowance. Login and BYOK keep their distinct
 * return targets; neither opening a dialog nor sending mail restores access. */
export function BudgetExhausted({ dict }: Props) {
  const login = useLoginDisclosure(), detailsId = useId();
  const [expanded, setExpanded] = useState(false);
  return <div className="chat-budget-exhausted grid min-w-0 gap-4 py-1">
    <BudgetNotice dict={dict} onLogin={login.show} expanded={expanded} onToggle={() => { setExpanded((value) => !value); }} detailsId={detailsId} />
    <div id={detailsId} hidden={!expanded} className="min-w-0">{expanded ? <ByokUpsell dict={dict} /> : null}</div>
    <LoginModal open={login.open} onClose={login.hide} returnTarget={useChatReturnTarget()} />
  </div>;
}
