import { useState } from "react";
import { LoginModal } from "../../../../components/auth/LoginModal";
import type { ChatDict } from "../../i18n";
import { FallbackRetryButton } from "./FallbackRetryButton";

type Props = Readonly<{ dict: ChatDict }>;
type ActionProps = Readonly<{ dict: ChatDict; onLogin: () => void }>;

function LoginAction({ dict, onLogin }: ActionProps) {
  return (
    <span className="chat-budget-exhausted__actions">
      <FallbackRetryButton label={dict.errorStates.d11Login} onClick={onLogin} className="chat-budget-exhausted__login" />
    </span>
  );
}

/**
 * D11: the anonymous daily budget is spent (issue #274 S1.8 X4). Same login
 * affordance as D8, but a visitor who never had a session is told the truth —
 * today's allowance ran out — instead of that their session expired. There is
 * nothing to resume, so the banner offers login only.
 */
export function BudgetExhausted({ dict }: Props) {
  const [loginOpen, setLoginOpen] = useState(false);
  return (
    <div className="chat-budget-exhausted" role="alert">
      <span>{dict.errorStates.d11Message}</span>
      <LoginAction dict={dict} onLogin={() => { setLoginOpen(true); }} />
      <LoginModal open={loginOpen} onClose={() => { setLoginOpen(false); }} />
    </div>
  );
}
