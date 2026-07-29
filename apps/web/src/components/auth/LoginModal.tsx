import { useEffect } from "react";
import type { Dict } from "../../i18n/dictionaries";
import { useDict } from "../../i18n/context";
import { LoginForm } from "./LoginForm";
import type { SendCommitted } from "./useMagicLinkForm";

interface LoginModalProps {
  open: boolean;
  onClose: () => void;
  /** Fires once the send is dispatched, so a caller can tell a "closed to go
   * read the email" dismissal apart from a cancellation. */
  onSendCommitted?: SendCommitted;
  /** Validated post-login destination carried in the mailed link (#284 T8). */
  returnTarget?: string;
}

function useEscapeToClose(open: boolean, onClose: () => void): void {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); };
  }, [open, onClose]);
}

function LoginDialog({ auth, onClose, onSendCommitted, returnTarget }: { auth: Dict["auth"]; onClose: () => void; onSendCommitted?: SendCommitted; returnTarget?: string }) {
  return (
    <div className="login-modal" role="dialog" aria-modal="true" aria-label={auth.title} onClick={(event) => { event.stopPropagation(); }}>
      <button className="login-modal__close" type="button" aria-label={auth.close} onClick={onClose}>×</button>
      <h2 className="login-modal__title">{auth.title}</h2>
      <p className="login-modal__subtitle">{auth.subtitle}</p>
      <LoginForm onSendCommitted={onSendCommitted} returnTarget={returnTarget} />
    </div>
  );
}

/** Magic-link login modal wired to the Neon Auth (Better Auth) client. */
export function LoginModal({ open, onClose, onSendCommitted, returnTarget }: LoginModalProps) {
  const auth = useDict().auth;
  useEscapeToClose(open, onClose);
  if (!open) return null;
  return (
    <div className="login-modal__mask" role="presentation" onClick={onClose}>
      <LoginDialog auth={auth} onClose={onClose} onSendCommitted={onSendCommitted} returnTarget={returnTarget} />
    </div>
  );
}
