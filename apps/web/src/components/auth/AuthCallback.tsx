import { useEffect } from "react";
import { useDict } from "../../i18n/context";
import type { Dict } from "../../i18n/dictionaries";
import type { DeferredReplayOutcome } from "../../features/chat/save/createOnLogin";
import { getAuthToken } from "../../lib/auth/authSession";
import { useAuthCallback } from "./useAuthCallback";
import type { AuthCallbackSession, AuthCallbackState } from "./useAuthCallback";

type MessageState = Extract<AuthCallbackState, "pending" | "error">;

function CallbackMessage({ state }: Readonly<{ state: MessageState }>) {
  const auth = useDict().auth;
  const role = state === "error" ? "alert" : "status";
  const text = state === "error" ? auth.callback_error : auth.callback_pending;
  return <p className="auth-callback__message" role={role}>{text}</p>;
}

type FailureProps = Readonly<{ auth: Dict["auth"]; session: AuthCallbackSession }>;

type ActionProps = Readonly<{ label: string; className: string; onClick: () => void }>;

function CallbackAction({ label, className, onClick }: ActionProps) {
  return <button type="button" className={className} onClick={onClick}>{label}</button>;
}

/**
 * The login succeeded but create-on-login did not. The intent is still on this
 * origin, so the visitor gets a retry here plus the explicit fallback — never a
 * silent "done" that lets the save reappear on some later login.
 */
function SaveFailure({ auth, session }: FailureProps) {
  return (
    <div className="auth-callback__save-failed" role="alert">
      <p className="auth-callback__message">{auth.callback_save_failed}</p>
      <CallbackAction label={auth.callback_save_retry} className="auth-callback__retry" onClick={session.retrySave} />
      <CallbackAction label={auth.callback_save_skip} className="auth-callback__skip" onClick={session.dismissSave} />
    </div>
  );
}

export interface AuthCallbackProps {
  readonly onDone: () => void;
  readonly establish?: () => Promise<string | undefined>;
  readonly replay?: () => Promise<DeferredReplayOutcome>;
}

function useDoneEffect(state: AuthCallbackState, onDone: () => void): void {
  useEffect(() => {
    if (state === "done") onDone();
  }, [state, onDone]);
}

function CallbackBody({ session }: Readonly<{ session: AuthCallbackSession }>) {
  const auth = useDict().auth;
  if (session.state === "done") return null;
  if (session.state === "save-failed") return <SaveFailure auth={auth} session={session} />;
  return <CallbackMessage state={session.state} />;
}

/** `/auth/callback` body: redeems the session, replays a deferred save, then
 * hands control back to the route — unless that replay failed. */
export function AuthCallback({ onDone, establish = getAuthToken, replay }: AuthCallbackProps) {
  const session = useAuthCallback(establish, replay);
  useDoneEffect(session.state, onDone);
  return <CallbackBody session={session} />;
}
