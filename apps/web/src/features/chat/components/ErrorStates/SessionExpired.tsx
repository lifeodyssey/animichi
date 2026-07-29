import { useState } from "react";
import { LoginModal } from "../../../../components/auth/LoginModal";
import type { ChatDict } from "../../i18n";
import { useChatReturnTarget } from "../../return-target";
import { FallbackRetryButton } from "./FallbackRetryButton";

type Props = Readonly<{ dict: ChatDict; onResume: () => void; recovering?: boolean }>;

type ActionProps = Readonly<{
  dict: ChatDict;
  onLogin: () => void;
  onResume: () => void;
  recovering?: boolean;
}>;

function ExpiryActions({ dict, onLogin, onResume, recovering }: ActionProps) {
  return (
    <span className="chat-session-expired__actions">
      <FallbackRetryButton label={dict.errorStates.d8Login} onClick={onLogin} className="chat-session-expired__login" />
      <FallbackRetryButton label={dict.errorStates.d8Resume} onClick={onResume} disabled={recovering} className="chat-session-expired__resume" />
    </span>
  );
}

/**
 * D8: an inline session-expiry banner. The conversation stays mounted — login
 * opens in place and resume re-reads the session's final state afterwards.
 */
export function SessionExpired({ dict, onResume, recovering }: Props) {
  const [open, setOpen] = useState(false);
  return (
    <div className="chat-session-expired" role="alert">
      <span>{dict.errorStates.d8Message}</span>
      <ExpiryActions dict={dict} onLogin={() => { setOpen(true); }} onResume={onResume} recovering={recovering} />
      <LoginModal open={open} onClose={() => { setOpen(false); }} returnTarget={useChatReturnTarget()} />
    </div>
  );
}
