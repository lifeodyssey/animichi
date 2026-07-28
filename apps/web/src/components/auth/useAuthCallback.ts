import { useCallback, useEffect, useState } from "react";
import { replayDeferredSave } from "../../features/chat/save/createOnLogin";
import type { DeferredReplayOutcome } from "../../features/chat/save/createOnLogin";
import { getAuthToken } from "../../lib/auth/authSession";

/**
 * `save-failed` is a *successful* login whose create-on-login replay failed. It
 * is reported rather than folded into `done`, because the intent survives a
 * failed replay: reporting a clean login would leave it to fire unannounced on
 * the next login inside its TTL.
 */
export type AuthCallbackState = "pending" | "done" | "error" | "save-failed";
type Establish = () => Promise<string | undefined>;
type Replay = () => Promise<DeferredReplayOutcome>;
type SetState = (state: AuthCallbackState) => void;

function stateFor(outcome: DeferredReplayOutcome): AuthCallbackState {
  return outcome === "failed" ? "save-failed" : "done";
}

/** The replay must not hold the visitor on the callback screen indefinitely: a
 * stalled users service degrades to the same surfaced-failure path as a 5xx. */
export const REPLAY_TIMEOUT_MS = 8_000;

function withTimeout(replay: Replay, ms: number): Promise<DeferredReplayOutcome> {
  return Promise.race([
    replay(),
    new Promise<DeferredReplayOutcome>((resolve) => setTimeout(() => { resolve("failed"); }, ms)),
  ]);
}

/** Create-on-login: a login the save CTA started replays its deferred intent;
 * any other login (the D8/D11 banners) finds none and saves nothing. */
async function redeem(establish: Establish, replay: Replay): Promise<AuthCallbackState> {
  const token = await establish();
  if (!token) return "error";
  return stateFor(await withTimeout(replay, REPLAY_TIMEOUT_MS));
}

/** Redeems the token once, dropping the result if the component unmounted first.
 * A rejection is a failed login, not an unhandled promise. */
function establishEffect(establish: Establish, replay: Replay, setState: SetState): () => void {
  let active = true;
  void redeem(establish, replay)
    .catch((): AuthCallbackState => "error")
    .then((state) => { if (active) setState(state); });
  return () => {
    active = false;
  };
}

function useEstablishOnce(establish: Establish, replay: Replay, setState: SetState): void {
  useEffect(() => establishEffect(establish, replay, setState), [establish, replay, setState]);
}

export interface AuthCallbackSession {
  readonly state: AuthCallbackState;
  /** Re-run only the create-on-login replay; the session is already redeemed. */
  readonly retrySave: () => void;
  /** Give up on the deferred save here; the intent stays for the chat page. */
  readonly dismissSave: () => void;
}

function useRetrySave(replay: Replay, setState: SetState): () => void {
  return useCallback(() => {
    setState("pending");
    void withTimeout(replay, REPLAY_TIMEOUT_MS)
      .catch((): DeferredReplayOutcome => "failed")
      .then((outcome) => { setState(stateFor(outcome)); });
  }, [replay, setState]);
}

/**
 * Redeems the Better Auth session cookie (set on the Neon Auth origin by the
 * magic-link verify redirect) for the app's cached bearer token, then replays a
 * deferred save when the login came from the 「保存する」 CTA. `establish` and
 * `replay` are injectable for tests; production callers rely on the defaults.
 */
export function useAuthCallback(
  establish: Establish = getAuthToken,
  replay: Replay = replayDeferredSave,
): AuthCallbackSession {
  const [state, setState] = useState<AuthCallbackState>("pending");
  useEstablishOnce(establish, replay, setState);
  const dismissSave = useCallback(() => { setState("done"); }, []);
  return { state, retrySave: useRetrySave(replay, setState), dismissSave };
}
