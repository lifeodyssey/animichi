import { useCallback, useState } from "react";
import { LoginModal } from "../../../../components/auth/LoginModal";
import { FallbackRetryButton } from "./FallbackRetryButton";

type Props = Readonly<{
  /** BEM block name; owns this banner's tint, shares the family geometry. */
  block: string;
  message: string;
  loginLabel: string;
  /** Set when a locked composer points its `aria-describedby` at this banner. */
  id?: string;
  /** `alert` when something failed; `status` when the surface is merely closed. */
  role?: "alert" | "status";
  /** D11's BYOK affordance (#284 T8): a second, non-login way forward. */
  secondary?: Readonly<{ label: string; onClick: () => void }>;
}>;

/**
 * The shared shape of the limit banners (D11 budget, D12 quota): an inline
 * live-region strip whose single affordance is login, mounted in place so the
 * conversation never unmounts. D8 is deliberately NOT built on this — its
 * second action (resume) makes it a different component, not a variant.
 */
type ActionProps = Readonly<{ block: string; loginLabel: string; onLogin: () => void; secondary?: Props["secondary"] }>;

function SecondaryAction({ block, secondary }: Readonly<{ block: string; secondary: Props["secondary"] }>) {
  if (secondary === undefined) return null;
  return <FallbackRetryButton label={secondary.label} onClick={secondary.onClick} className={`${block}__byok`} />;
}

function LoginAction({ block, loginLabel, onLogin, secondary }: ActionProps) {
  return (
    <span className={`${block}__actions`}>
      <FallbackRetryButton label={loginLabel} onClick={onLogin} className={`${block}__login`} />
      <SecondaryAction block={block} secondary={secondary} />
    </span>
  );
}

function useLoginModal() {
  const [open, setOpen] = useState(false);
  const show = useCallback(() => { setOpen(true); }, []);
  const hide = useCallback(() => { setOpen(false); }, []);
  return { open, show, hide };
}

export function LimitBanner({ block, message, loginLabel, id, role = "alert", secondary }: Props) {
  const login = useLoginModal();
  return (
    <div className={block} id={id} role={role}>
      <span>{message}</span>
      <LoginAction block={block} loginLabel={loginLabel} onLogin={login.show} secondary={secondary} />
      <LoginModal open={login.open} onClose={login.hide} />
    </div>
  );
}
