import { useCallback, useEffect, useState } from "react";
import { replayDeferredSave } from "../../features/chat/save/createOnLogin";
import type { DeferredReplayOutcome } from "../../features/chat/save/createOnLogin";
import { getAuthToken } from "../../lib/auth/authSession";
import {
  MIGRATE_TIMEOUT_MS,
  anomalyOf,
  migrateAnonymousSession,
  reportMigrationAnomaly,
} from "../../lib/auth/sessionMigration";
import type { MigrationAnomaly, SessionMigrationOutcome } from "../../lib/auth/sessionMigration";

/**
 * `save-failed` is a *successful* login whose create-on-login replay failed. It
 * is reported rather than folded into `done`, because the intent survives a
 * failed replay: reporting a clean login would leave it to fire unannounced on
 * the next login inside its TTL.
 *
 * `migration-failed` is the same idea for the anonymous-session claim (#507
 * review P1-3). `apps/web` has no telemetry sink, so a log line reaches nobody
 * — the visitor is the only party who can act, and the only real outlet.
 */
export type AuthCallbackState = "pending" | "done" | "error" | "save-failed" | "migration-failed";
type Establish = () => Promise<string | undefined>;
type Replay = () => Promise<DeferredReplayOutcome>;
type Migrate = (token: string) => Promise<SessionMigrationOutcome>;
type SetState = (state: AuthCallbackState) => void;

/** `undefined` = landed; `"dismissed"` = the visitor chose to move on. */
type MigrationState = MigrationAnomaly | "dismissed" | undefined;

const FAILED_REPLAY: DeferredReplayOutcome = "failed";

function stateFor(outcome: DeferredReplayOutcome): AuthCallbackState {
  return outcome === "failed" ? "save-failed" : "done";
}

/** The replay must not hold the visitor on the callback screen indefinitely: a
 * stalled users service degrades to the same surfaced-failure path as a 5xx. */
export const REPLAY_TIMEOUT_MS = 8_000;

/** `async` on purpose: it turns a collaborator that throws *synchronously* into
 * a rejected promise. Without it the throw escapes past the caller's `.catch`
 * — the exact fragility that made a failed claim report the login as an error
 * (#507 review P2). */
async function withTimeout<T>(run: () => Promise<T>, ms: number, onTimeout: T): Promise<T> {
  return Promise.race([
    run(),
    new Promise<T>((resolve) => setTimeout(() => { resolve(onTimeout); }, ms)),
  ]);
}

/**
 * Structurally incapable of rejecting (#507 review P2). It rides a
 * `Promise.all` beside the replay, so a throw here would reject the whole
 * `redeem` and report a *successful* login as `"error"`. `migrateAnonymousSession`
 * already catches, but relying on a collaborator's internals for that is the
 * fragile version — this makes it a property of the call site, and a
 * throwing-migrate test pins it.
 *
 * A timeout is recorded as `failed`. The `withTimeout` race does not abort the
 * request, so the server may still succeed afterwards and this becomes a false
 * negative. This is **the one** case the #507 owner ruling actually rescues:
 * under the old edge the server's `migrated: true` would have retired the `aid`
 * cookie, leaving the retry with no identity to present. Every other failure
 * branch already kept its cookie — retirement was gated on `didMigrate` — so
 * "keeping the cookie makes failures recoverable" is true for this timing race
 * and not in general. Either way the retry is the same idempotent `UPDATE`.
 */
async function runMigration(migrate: Migrate, token: string, expected: boolean): Promise<MigrationState> {
  const outcome = await withTimeout(() => migrate(token), MIGRATE_TIMEOUT_MS, "failed")
    .catch((): SessionMigrationOutcome => "failed");
  const anomaly = anomalyOf(outcome, expected);
  if (anomaly !== undefined) reportMigrationAnomaly(anomaly);
  return anomaly;
}

interface Collaborators {
  readonly establish: Establish;
  readonly replay: Replay;
  readonly migrate: Migrate;
  readonly expectsMigration: boolean;
}

interface RedeemResult {
  readonly state: AuthCallbackState;
  readonly migration: MigrationState;
}

/** Create-on-login: a login the save CTA started replays its deferred intent;
 * any other login (the D8/D11 banners) finds none and saves nothing.
 *
 * The migration runs **alongside** the replay, not before or after it: they
 * share no data (the migration re-points `conversations.user_id` in the agent's
 * database; the replay creates a *fresh* route through the users Worker from
 * client-held point ids), and both already hold the token `establish` returned.
 * Serialising them would add the migration's budget to this interstitial's
 * worst case to buy an ordering nothing depends on. */
async function redeem(c: Collaborators): Promise<RedeemResult> {
  const token = await c.establish();
  if (!token) return { state: "error", migration: undefined };
  const [outcome, migration] = await Promise.all([
    withTimeout(c.replay, REPLAY_TIMEOUT_MS, FAILED_REPLAY),
    runMigration(c.migrate, token, c.expectsMigration),
  ]);
  return { state: stateFor(outcome), migration };
}

type SetMigration = (migration: MigrationState) => void;

/** Redeems the token once, dropping the result if the component unmounted first.
 * A rejection is a failed login, not an unhandled promise. */
function establishEffect(c: Collaborators, setState: SetState, setMigration: SetMigration): () => void {
  let active = true;
  const apply = (r: RedeemResult) => { if (active) { setMigration(r.migration); setState(r.state); } };
  void redeem(c).catch((): RedeemResult => ({ state: "error", migration: undefined })).then(apply);
  return () => { active = false; };
}

function useEstablishOnce(c: Collaborators, setState: SetState, setMigration: SetMigration): void {
  const { establish, replay, migrate, expectsMigration } = c;
  useEffect(
    () => establishEffect({ establish, replay, migrate, expectsMigration }, setState, setMigration),
    [establish, replay, migrate, expectsMigration, setState, setMigration],
  );
}

export interface AuthCallbackSession {
  readonly state: AuthCallbackState;
  /** Which anomaly the migration notice is reporting, for its copy. */
  readonly migration: MigrationAnomaly | undefined;
  /** Re-run only the create-on-login replay; the session is already redeemed. */
  readonly retrySave: () => void;
  /** Give up on the deferred save *here*; the intent survives for the next login
   * inside its TTL, which is what replays it. */
  readonly dismissSave: () => void;
  /** Re-run only the ownership claim. Safe to repeat: the server-side `UPDATE`
   * matches zero rows the second time, and the `aid` cookie still resolves. */
  readonly retryMigration: () => void;
  /** Move on without the claim. The anonymous work stays behind that identity,
   * reachable by a later login — until the 30-day routeless-session purge. */
  readonly dismissMigration: () => void;
}

function useRetrySave(replay: Replay, setState: SetState): () => void {
  return useCallback(() => {
    setState("pending");
    void withTimeout(replay, REPLAY_TIMEOUT_MS, FAILED_REPLAY)
      .catch((): DeferredReplayOutcome => "failed")
      .then((outcome) => { setState(stateFor(outcome)); });
  }, [replay, setState]);
}

/** The claim needs a bearer of its own; `establish` re-reads the cached token. */
async function retriedMigration(c: Collaborators): Promise<MigrationState> {
  const token = await c.establish();
  if (!token) return "failed";
  return runMigration(c.migrate, token, c.expectsMigration);
}

function useRetryMigration(c: Collaborators, setMigration: SetMigration): () => void {
  const { establish, migrate, replay, expectsMigration } = c;
  return useCallback(() => {
    void retriedMigration({ establish, migrate, replay, expectsMigration })
      .catch((): MigrationState => "failed")
      .then(setMigration);
  }, [establish, migrate, replay, expectsMigration, setMigration]);
}

/** The save surface wins while it is showing: it is the thing the visitor
 * asked for and can act on. The migration notice takes over once that is
 * settled, so neither failure is swallowed by the other. */
function derivedState(state: AuthCallbackState, migration: MigrationState): AuthCallbackState {
  if (state !== "done") return state;
  return migration === undefined || migration === "dismissed" ? "done" : "migration-failed";
}

/**
 * Redeems the Better Auth session cookie (set on the Neon Auth origin by the
 * magic-link verify redirect) for the app's cached bearer token, then replays a
 * deferred save when the login came from the 「保存する」 CTA, and claims the
 * browser's anonymous sessions for the new account (#507). `establish`,
 * `replay` and `migrate` are injectable for tests; production callers — every
 * magic-link, OTP and OAuth login funnels through here — rely on the defaults.
 *
 * `expectsMigration` says the login's return target named a chat session, so a
 * `{"migrated": false}` is an anomaly rather than a normal no-op.
 */
export function useAuthCallback(
  establish: Establish = getAuthToken, replay: Replay = replayDeferredSave,
  migrate: Migrate | undefined = migrateAnonymousSession, expectsMigration = false,
): AuthCallbackSession {
  return useCallbackSession({ establish, replay, migrate, expectsMigration });
}

function useCallbackSession(c: Collaborators): AuthCallbackSession {
  const [state, setState] = useState<AuthCallbackState>("pending");
  const [migration, setMigration] = useState<MigrationState>(undefined);
  useEstablishOnce(c, setState, setMigration);
  const surfaced = { state: derivedState(state, migration), migration: shown(migration) };
  return { ...surfaced, ...useSaveActions(c.replay, setState), ...useClaimActions(c, setMigration) };
}

/** A dismissed notice is gone, not merely hidden: nothing should re-render it. */
function shown(migration: MigrationState): MigrationAnomaly | undefined {
  return migration === "dismissed" ? undefined : migration;
}

function useSaveActions(replay: Replay, setState: SetState) {
  return {
    retrySave: useRetrySave(replay, setState),
    dismissSave: useCallback(() => { setState("done"); }, [setState]),
  };
}

function useClaimActions(c: Collaborators, setMigration: SetMigration) {
  return {
    retryMigration: useRetryMigration(c, setMigration),
    dismissMigration: useCallback(() => { setMigration("dismissed"); }, [setMigration]),
  };
}
