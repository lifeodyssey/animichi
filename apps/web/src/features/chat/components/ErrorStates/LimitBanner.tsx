import { useCallback, useState } from "react";
import { LoginModal } from "../../../auth/ui/LoginModal";
import { useChatReturnTarget } from "../../ChatReturnTarget";
import { FallbackRetryButton } from "./FallbackRetryButton";
import { InlineNotice } from "./InlineNotice";

type Props = Readonly<{
  /** BEM block name, kept on the notice as an unstyled hook for tests. */
  block: string;
  message: string;
  loginLabel: string;
  /** Optional id for a control that describes itself with this notice. */
  id?: string;
  /** `alert` when something failed; `status` when the surface is merely closed. */
  role?: "alert" | "status";
  /** D11's BYOK affordance (#284 T8): a second, non-login way forward. */
  secondary?: Readonly<{ label: string; onClick: () => void }>;
}>;

/**
 * In-place login for the shared-budget gate, with an optional BYOK action.
 * Per-visitor quota and expired sessions own their distinct presentations.
 */
type ActionProps = Readonly<{ block: string; loginLabel: string; onLogin: () => void; secondary?: Props["secondary"] }>;

function SecondaryAction({ block, secondary }: Readonly<{ block: string; secondary: Props["secondary"] }>) {
  if (secondary === undefined) return null;
  return <FallbackRetryButton label={secondary.label} onClick={secondary.onClick} className={`${block}__byok`} />;
}

function LoginAction({ block, loginLabel, onLogin, secondary }: ActionProps) {
  return (
    <>
      <FallbackRetryButton label={loginLabel} onClick={onLogin} className={`${block}__login`} />
      <SecondaryAction block={block} secondary={secondary} />
    </>
  );
}

function useLoginModal() {
  const [open, setOpen] = useState(false);
  const show = useCallback(() => { setOpen(true); }, []);
  const hide = useCallback(() => { setOpen(false); }, []);
  return { open, show, hide };
}

function LimitNotice({ block, message, loginLabel, id, role = "alert", secondary, onLogin }: Props & Readonly<{ onLogin: () => void }>) {
  const actions = <LoginAction block={block} loginLabel={loginLabel} onLogin={onLogin} secondary={secondary} />;
  return (
    <InlineNotice block={block} tone="auth" role={role} id={id} actions={actions}>
      {message}
    </InlineNotice>
  );
}

export function LimitBanner(props: Props) {
  const login = useLoginModal();
  return (
    <>
      <LimitNotice {...props} onLogin={login.show} />
      <LoginModal open={login.open} onClose={login.hide} returnTarget={useChatReturnTarget()} />
    </>
  );
}
