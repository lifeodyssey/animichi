import { useCallback, useEffect, useState } from "react";
import { replayDeferredSave } from "../../features/chat/save/createOnLogin";
import type { DeferredReplayOutcome } from "../../features/chat/save/createOnLogin";
import { getAuthToken } from "../../lib/auth/authSession";
import { migrateAnonymousSession, reportMigrationFailure } from "../../lib/auth/sessionMigration";
import type { SessionMigrationOutcome } from "../../lib/auth/sessionMigration";

/**
 * `save-failed` is a *successful* login whose create-on-login replay failed. It
 * is reported rather than folded into `done`, because the intent survives a
 * failed replay: reporting a clean login would leave it to fire unannounced on
 * the next login inside its TTL.
 */
export type AuthCallbackState = "pending" | "done" | "error" | "save-failed";
type Establish = () => Promise<string | undefined>;
type Replay = () => Promise<DeferredReplayOutcome>;
type Migrate = (token: string) => Promise<SessionMigrationOutcome>;
type SetState = (state: AuthCallbackState) => void;

const FAILED_REPLAY: DeferredReplayOutcome = "failed";

function stateFor(outcome: DeferredReplayOutcome): AuthCallbackState {
  return outcome === "failed" ? "save-failed" : "done";
}

/** The replay must not hold the visitor on the callback screen indefinitely: a
 * stalled users service degrades to the same surfaced-failure path as a 5xx. */
export const REPLAY_TIMEOUT_MS = 8_000;

/** The migration is a single identity-dimensional `UPDATE` behind one edge hop.
 * It gets the replay's budget for the replay's reason — a stalled service must
 * degrade to the failure path rather than pin the visitor on this screen. */
export const MIGRATE_TIMEOUT_MS = REPLAY_TIMEOUT_MS;

function withTimeout<T>(run: () => Promise<T>, ms: number, onTimeout: T): Promise<T> {
  return Promise.race([
    run(),
    new Promise<T>((resolve) => setTimeout(() => { resolve(onTimeout); }, ms)),
  ]);
}

/**
 * Issue #507: the ownership migration must not block the login, because the
 * login already succeeded — the visitor is authenticated whatever this returns,
 * and stranding them on an interstitial over it would be a worse outcome than
 * the thing it reports. It is not silent either:
 *
 *  - the failure is recorded as a structured event, and
 *  - it is genuinely recoverable without the visitor doing anything. The edge
 *    retires the `aid` cookie only on `{"migrated": true}`, so a failed run
 *    leaves the anonymous identity — and the work it owns — intact, and the
 *    next login on this browser migrates it. A user-facing retry would buy a
 *    prompt over a path that already self-heals.
 */
async function runMigration(migrate: Migrate, token: string): Promise<void> {
  const outcome = await withTimeout(() => migrate(token), MIGRATE_TIMEOUT_MS, "failed");
  if (outcome === "failed") reportMigrationFailure();
}

/** Create-on-login: a login the save CTA started replays its deferred intent;
 * any other login (the D8/D11 banners) finds none and saves nothing.
 *
 * The migration runs **alongside** the replay, not before or after it: they
 * share no data (the migration re-points `conversations.user_id` in the agent's
 * database; the replay creates a *fresh* route through the users Worker from
 * client-held point ids), and both already hold the token `establish` returned.
 * Serialising them would double this interstitial's worst case to 16s to buy
 * an ordering nothing depends on. When both fail the visitor sees the save
 * failure alone — the one they asked for and can act on. */
async function redeem(establish: Establish, replay: Replay, migrate: Migrate): Promise<AuthCallbackState> {
  const token = await establish();
  if (!token) return "error";
  const [outcome] = await Promise.all([
    withTimeout(replay, REPLAY_TIMEOUT_MS, FAILED_REPLAY),
    runMigration(migrate, token),
  ]);
  return stateFor(outcome);
}

/** Redeems the token once, dropping the result if the component unmounted first.
 * A rejection is a failed login, not an unhandled promise. */
function establishEffect(est: Establish, replay: Replay, migrate: Migrate, setState: SetState): () => void {
  let active = true;
  void redeem(est, replay, migrate)
    .catch((): AuthCallbackState => "error")
    .then((state) => { if (active) setState(state); });
  return () => { active = false; };
}

function useEstablishOnce(
  establish: Establish, replay: Replay, migrate: Migrate, setState: SetState,
): void {
  useEffect(
    () => establishEffect(establish, replay, migrate, setState),
    [establish, replay, migrate, setState],
  );
}

export interface AuthCallbackSession {
  readonly state: AuthCallbackState;
  /** Re-run only the create-on-login replay; the session is already redeemed. */
  readonly retrySave: () => void;
  /** Give up on the deferred save *here*; the intent survives for the next login
   * inside its TTL, which is what replays it. */
  readonly dismissSave: () => void;
}

function useRetrySave(replay: Replay, setState: SetState): () => void {
  return useCallback(() => {
    setState("pending");
    void withTimeout(replay, REPLAY_TIMEOUT_MS, FAILED_REPLAY)
      .catch((): DeferredReplayOutcome => "failed")
      .then((outcome) => { setState(stateFor(outcome)); });
  }, [replay, setState]);
}

/**
 * Redeems the Better Auth session cookie (set on the Neon Auth origin by the
 * magic-link verify redirect) for the app's cached bearer token, then replays a
 * deferred save when the login came from the 「保存する」 CTA, and claims the
 * browser's anonymous sessions for the new account (#507). `establish`,
 * `replay` and `migrate` are injectable for tests; production callers — every
 * magic-link, OTP and OAuth login funnels through here — rely on the defaults.
 */
export function useAuthCallback(
  establish: Establish = getAuthToken,
  replay: Replay = replayDeferredSave,
  migrate: Migrate = migrateAnonymousSession,
): AuthCallbackSession {
  const [state, setState] = useState<AuthCallbackState>("pending");
  useEstablishOnce(establish, replay, migrate, setState);
  const dismissSave = useCallback(() => { setState("done"); }, []);
  return { state, retrySave: useRetrySave(replay, setState), dismissSave };
}
