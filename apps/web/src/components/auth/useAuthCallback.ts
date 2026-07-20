import { useEffect, useState } from "react";
import { getAuthToken } from "../../lib/auth/authSession";

export type AuthCallbackState = "pending" | "done" | "error";
type Establish = () => Promise<string | undefined>;
type SetState = (state: AuthCallbackState) => void;

/** Redeems the token once, dropping the result if the component unmounted first. */
function establishEffect(establish: Establish, setState: SetState): () => void {
  let active = true;
  void establish().then((token) => {
    if (active) setState(token ? "done" : "error");
  });
  return () => {
    active = false;
  };
}

function useEstablishOnce(establish: Establish, setState: SetState): void {
  useEffect(() => establishEffect(establish, setState), [establish, setState]);
}

/**
 * Redeems the Better Auth session cookie (set on the Neon Auth origin by the
 * magic-link verify redirect) for the app's cached bearer token. `establish`
 * is injectable for tests; production callers rely on the default.
 */
export function useAuthCallback(establish: Establish = getAuthToken): AuthCallbackState {
  const [state, setState] = useState<AuthCallbackState>("pending");
  useEstablishOnce(establish, setState);
  return state;
}
