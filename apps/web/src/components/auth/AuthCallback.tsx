import { useEffect } from "react";
import { useDict } from "../../i18n/context";
import { getAuthToken } from "../../lib/auth/authSession";
import { useAuthCallback } from "./useAuthCallback";
import type { AuthCallbackState } from "./useAuthCallback";

type MessageState = Exclude<AuthCallbackState, "done">;

function CallbackMessage({ state }: Readonly<{ state: MessageState }>) {
  const auth = useDict().auth;
  const role = state === "error" ? "alert" : "status";
  const text = state === "error" ? auth.callback_error : auth.callback_pending;
  return <p className="auth-callback__message" role={role}>{text}</p>;
}

export interface AuthCallbackProps {
  readonly onDone: () => void;
  readonly establish?: () => Promise<string | undefined>;
}

/** `/auth/callback` body: redeems the session, then hands control back to the route. */
export function AuthCallback({ onDone, establish = getAuthToken }: AuthCallbackProps) {
  const state = useAuthCallback(establish);
  useEffect(() => {
    if (state === "done") onDone();
  }, [state, onDone]);
  return state === "done" ? null : <CallbackMessage state={state} />;
}
