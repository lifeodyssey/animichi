import { Button } from "animal-island-ui-tailwind/button";
import { useId, useState } from "react";
import { LoginModal } from "../../../auth/ui/LoginModal";
import type { ChatDict } from "../../i18n";
import { useChatReturnTarget } from "../../ChatReturnTarget";

type Props = Readonly<{ dict: ChatDict; onResume: () => void; recovering?: boolean }>;

type ActionProps = Readonly<{
  dict: ChatDict;
  onLogin: () => void;
  onResume: () => void;
  recovering?: boolean;
  descriptionId: string;
}>;

const ACTION = "[min-height:44px]! [height:auto]! [font-size:14px]! [line-height:1.5]! [white-space:normal]! [--animal-text-color:var(--color-primary-strong)] focus-visible:outline-primary-strong motion-reduce:transition-none";
const UNAVAILABLE = "animal-btn-disabled [pointer-events:none]";

function ExpiryMark({ recovering }: Readonly<{ recovering: boolean }>) {
  return <span aria-hidden="true" className={`mt-0.5 [display:grid] size-7 shrink-0 place-items-center rounded-full ${recovering ? "bg-primary-soft text-primary-strong" : "bg-gold-soft text-fg"}`}>
    {recovering ? <span className="size-3.5 rounded-full border-2 border-primary/25 border-t-primary-strong motion-safe:animate-spin motion-safe:[animation-duration:1.4s] motion-reduce:animate-none" /> : <svg className="size-4" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round"><rect x="4.5" y="8.5" width="11" height="8" rx="2" /><path d="M7 8.5V6a3 3 0 0 1 6 0v2.5M10 12v1.5" /></svg>}
  </span>;
}

function ResumeAction({ dict, onResume, recovering = false, descriptionId }: Omit<ActionProps, "onLogin">) {
  const hintId = useId();
  return <div className="flex min-w-0 flex-wrap items-center gap-x-1 text-sm text-muted-fg">
    <span id={hintId}>{dict.errorStates.d8ResumeHint}</span>
    <Button htmlType="button" type="text" className={`chat-session-expired__resume ${ACTION} [padding:10px_2px]! underline underline-offset-4 ${recovering ? UNAVAILABLE : ""}`} onClick={() => { if (!recovering) onResume(); }} aria-disabled={recovering} aria-busy={recovering} aria-describedby={`${hintId} ${descriptionId}`}>{dict.errorStates.d8Resume}</Button>
  </div>;
}

function ExpiryActions({ dict, onLogin, onResume, recovering = false, descriptionId }: ActionProps) {
  return <div className="col-start-2 grid min-w-0 justify-items-start gap-1">
    <Button htmlType="button" type="default" className={`chat-session-expired__login ${ACTION} [padding:9px_16px]! [--animal-bg-color:var(--color-paper)] ${recovering ? UNAVAILABLE : ""}`} onClick={() => { if (!recovering) onLogin(); }} aria-disabled={recovering} aria-describedby={descriptionId} aria-haspopup="dialog">{dict.errorStates.d8Login}</Button>
    <ResumeAction dict={dict} onResume={onResume} recovering={recovering} descriptionId={descriptionId} />
  </div>;
}

function ExpiryNotice(props: Omit<ActionProps, "descriptionId">) {
  const { dict, recovering = false } = props, descriptionId = useId(), copy = dict.errorStates;
  return <div className="chat-session-expired grid min-w-0 grid-cols-[28px_minmax(0,1fr)] items-start gap-x-3 gap-y-3 py-1 text-sm leading-6 text-fg" role={recovering ? "status" : "alert"} aria-atomic="true">
    <ExpiryMark recovering={recovering} />
    <div id={descriptionId} className="grid min-w-0 gap-1 [overflow-wrap:anywhere]"><p className="font-semibold">{recovering ? copy.d8Recovering : copy.d8Message}</p><p className="text-muted-fg">{recovering ? copy.d8RecoveringHint : copy.d8Hint}</p></div>
    <ExpiryActions {...props} descriptionId={descriptionId} />
  </div>;
}

/** Login opens in place. Only the caller can confirm that history is being read;
 * opening or closing the dialog and dispatching mail never imply authentication. */
export function SessionExpired({ dict, onResume, recovering = false }: Props) {
  const [open, setOpen] = useState(false);
  return <>
    <ExpiryNotice dict={dict} onLogin={() => { setOpen(true); }} onResume={onResume} recovering={recovering} />
    <LoginModal open={open} onClose={() => { setOpen(false); }} returnTarget={useChatReturnTarget()} />
  </>;
}
