import { useEffect } from "react";
import type { Dict } from "../../i18n/dictionaries";
import { useDict } from "../../i18n/context";
import { LoginForm } from "./LoginForm";

interface LoginModalProps {
  open: boolean;
  onClose: () => void;
  /** Fires when a magic link was dispatched, so a caller can tell a
   * "closed to go read the email" dismissal apart from a cancellation. */
  onSent?: () => void;
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

function LoginDialog({ auth, onClose, onSent }: { auth: Dict["auth"]; onClose: () => void; onSent?: () => void }) {
  return (
    <div className="login-modal" role="dialog" aria-modal="true" aria-label={auth.title} onClick={(event) => { event.stopPropagation(); }}>
      <button className="login-modal__close" type="button" aria-label={auth.close} onClick={onClose}>×</button>
      <h2 className="login-modal__title">{auth.title}</h2>
      <p className="login-modal__subtitle">{auth.subtitle}</p>
      <LoginForm onSent={onSent} />
    </div>
  );
}

/** Magic-link login modal wired to the Neon Auth (Better Auth) client. */
export function LoginModal({ open, onClose, onSent }: LoginModalProps) {
  const auth = useDict().auth;
  useEscapeToClose(open, onClose);
  if (!open) return null;
  return (
    <div className="login-modal__mask" role="presentation" onClick={onClose}>
      <LoginDialog auth={auth} onClose={onClose} onSent={onSent} />
    </div>
  );
}
