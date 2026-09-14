import { Button } from "animal-island-ui-tailwind/button";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { LoginModal } from "../../auth/ui/LoginModal";
import { useChatReturnTarget, useChatSessionId } from "../ChatReturnTarget";
import type { AuthStatus } from "../../../lib/auth/session";
import type { ChatDict } from "../i18n";

type Props = Readonly<{ dict: ChatDict; status: AuthStatus }>;

const BAR = "chat-appbar [display:flex] min-w-0 items-center justify-between gap-3 px-4 py-3 text-ground-ink lg:[display:none]";
const CONTROL = "[min-height:44px]! [height:44px]! [padding:0_12px]! [font-size:14px]! [font-weight:600]! [--animal-text-color:var(--color-ground-ink)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ground-ink motion-reduce:[transition:none]!";
const ICON = "[width:44px]! [min-width:44px]! [padding:0]! shrink-0 no-underline";
const NEW = `animal-btn animal-btn-default animal-btn-middle ${CONTROL} ${ICON} [--animal-bg-color:var(--color-paper)] [--animal-border-color:var(--color-border-soft)]`;
const SETTINGS = `animal-btn animal-btn-text animal-btn-middle ${CONTROL} ${ICON}`;

function NewJourneyIcon() {
  return <svg aria-hidden="true" className="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round"><path d="M13 4H6a2 2 0 0 0-2 2v14l4-3h10a2 2 0 0 0 2-2v-4M18 3v6M15 6h6" /></svg>;
}

function SettingsIcon() {
  return <svg aria-hidden="true" className="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round"><path d="M4 7h9m4 0h3M4 17h3m4 0h9" /><circle cx="15" cy="7" r="2" /><circle cx="9" cy="17" r="2" /></svg>;
}

/** Document navigation starts a fresh conversation, as the existing sidebar does. */
function NewJourneyButton({ dict }: Readonly<{ dict: ChatDict }>) {
  return <a href="/chat" className={NEW} aria-label={dict.newJourney} title={dict.newJourney}><NewJourneyIcon /></a>;
}

function LoginEntry({ dict, status }: Props) {
  const [open, setOpen] = useState(false), returnTarget = useChatReturnTarget();
  if (status !== "anonymous") return null;
  return <><Button type="text" htmlType="button" className={CONTROL} onClick={() => { setOpen(true); }}>{dict.appbar.login}</Button><LoginModal open={open} onClose={() => { setOpen(false); }} returnTarget={returnTarget} /></>;
}

/** Settings retains the current session so its return link can restore the conversation. */
function SettingsLink({ dict }: Readonly<{ dict: ChatDict }>) {
  const session = useChatSessionId();
  return <Link to="/settings" search={{ session }} className={SETTINGS} aria-label={dict.appbar.settings} title={dict.appbar.settings}><SettingsIcon /></Link>;
}

export function ChatAppBar({ dict, status }: Props) {
  return <header className={BAR}>
    <span className="min-w-0 truncate text-base font-extrabold leading-6" title={dict.appbar.brand}>{dict.appbar.brand}</span>
    <div className="[display:flex] shrink-0 items-center gap-1"><LoginEntry dict={dict} status={status} /><NewJourneyButton dict={dict} /><SettingsLink dict={dict} /></div>
  </header>;
}
