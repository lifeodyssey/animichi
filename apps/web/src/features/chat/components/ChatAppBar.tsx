import { useState } from "react";
import type { ReactNode } from "react";
import { LoginModal } from "../../auth/ui/LoginModal";
import { useChatReturnTarget } from "../ChatReturnTarget";
import type { AuthStatus } from "../../../lib/auth/session";
import type { ChatDict } from "../i18n";

/** Design sync `.brand .mk`: the torii with the fox peeking out from behind it. */
function ToriiFoxMark() {
  return (
    <span className="chat-appbar__mark">
      <img className="chat-appbar__torii" src="/images/landing/torii.svg" alt="" width={40} height={40} />
      <img className="chat-appbar__fox" src="/images/landing/fox/fox-curious.svg" alt="" width={24} height={24} />
    </span>
  );
}

/** Design sync `.brand .tt`: the localized name over the latin AI GUIDE lockup. */
function ChatWordmark({ dict }: Readonly<{ dict: ChatDict }>) {
  return (
    <span className="chat-appbar__wordmark">
      <span className="chat-appbar__name">{dict.appbar.brand}</span>
      <span className="chat-appbar__tagline">{dict.appbar.tagline}</span>
    </span>
  );
}

function PlusIcon() {
  return (
    <svg className="chat-appbar__plus" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" aria-hidden="true">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

/**
 * A conversation's identity is its `?session=` scope (`use-chat-session`'s
 * `scopeOf`), and a client-side navigation to `/chat` cannot reset a draft that
 * is already scoped to `chat:draft`. So this is deliberately a document
 * navigation: the page's own cold start is the existing capability that yields
 * a genuinely new conversation from every state, and no new backend behaviour
 * is invented for it.
 */
function NewConversationLink({ dict }: Readonly<{ dict: ChatDict }>) {
  return (
    <a className="chat-appbar__new" href="/chat" aria-label={dict.appbar.newConversation}>
      <PlusIcon />
      <span className="chat-appbar__new-label">{dict.appbar.newConversation}</span>
    </a>
  );
}

/** Signed in: the design's teal disc, labelled — it reports state, it is not a
 * menu, because the app has no account menu to open. */
function SignedInBadge({ dict }: Readonly<{ dict: ChatDict }>) {
  return <span className="chat-appbar__avatar" role="img" aria-label={dict.appbar.signedIn} />;
}

/**
 * The identity slot. An unauthenticated visitor must never be shown a stand-in
 * avatar, so anonymous gets the login entry instead, and `pending` renders
 * nothing at all rather than a placeholder that would resolve into something
 * else a moment later.
 */
export function ChatIdentitySlot({ dict, status }: Readonly<{ dict: ChatDict; status: AuthStatus }>) {
  const [open, setOpen] = useState(false);
  const returnTarget = useChatReturnTarget();
  if (status === "pending") return null;
  if (status === "authenticated") return <SignedInBadge dict={dict} />;
  return <>
    <button type="button" className="chat-appbar__login" onClick={() => { setOpen(true); }}>{dict.appbar.login}</button>
    <LoginModal open={open} onClose={() => { setOpen(false); }} returnTarget={returnTarget} />
  </>;
}

/** Design sync `.brand`: the mark and the wordmark read as one lockup. */
function ChatBrand({ dict }: Readonly<{ dict: ChatDict }>) {
  return (
    <span className="chat-appbar__brand">
      <ToriiFoxMark />
      <ChatWordmark dict={dict} />
    </span>
  );
}

/**
 * The chat's chrome (design sync `.appbar`). It sits above the notices so a
 * banner that comes and goes never shifts the brand, and it stays outside the
 * banner's `role="alert"` so page-state announcements are not read as chrome.
 */
type Props = Readonly<{ dict: ChatDict; status: AuthStatus; settings?: ReactNode }>;

export function ChatAppBar({ dict, status, settings }: Props) {
  return (
    <header className="chat-appbar">
      <ChatBrand dict={dict} />
      <NewConversationLink dict={dict} />
      {settings}
      <ChatIdentitySlot dict={dict} status={status} />
    </header>
  );
}
