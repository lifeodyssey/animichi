import { useEffect, useState } from "react";
import { replayDeferredSave } from "../../features/chat/save/createOnLogin";
import { getAuthToken } from "../../lib/auth/authSession";

export type AuthCallbackState = "pending" | "done" | "error";
type Establish = () => Promise<string | undefined>;
type Replay = () => Promise<boolean>;
type SetState = (state: AuthCallbackState) => void;

/** Create-on-login: a login the save CTA started replays its deferred intent;
 * any other login (the D8/D11 banners) finds none and saves nothing. */
async function redeem(establish: Establish, replay: Replay): Promise<AuthCallbackState> {
  const token = await establish();
  if (!token) return "error";
  await replay();
  return "done";
}

/** Redeems the token once, dropping the result if the component unmounted first. */
function establishEffect(establish: Establish, replay: Replay, setState: SetState): () => void {
  let active = true;
  void redeem(establish, replay).then((state) => {
    if (active) setState(state);
  });
  return () => {
    active = false;
  };
}

function useEstablishOnce(establish: Establish, replay: Replay, setState: SetState): void {
  useEffect(() => establishEffect(establish, replay, setState), [establish, replay, setState]);
}

/**
 * Redeems the Better Auth session cookie (set on the Neon Auth origin by the
 * magic-link verify redirect) for the app's cached bearer token. `establish`
 * is injectable for tests; production callers rely on the default.
 */
export function useAuthCallback(
  establish: Establish = getAuthToken,
  replay: Replay = replayDeferredSave,
): AuthCallbackState {
  const [state, setState] = useState<AuthCallbackState>("pending");
  useEstablishOnce(establish, replay, setState);
  return state;
}
