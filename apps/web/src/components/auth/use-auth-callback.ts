import { useCallback, useEffect, useRef, useState } from "react";
import { replayDeferredSave } from "../../features/chat/save/complete-deferred-save";
import type { DeferredReplayOutcome } from "../../features/chat/save/complete-deferred-save";
import { establishAuthSession } from "../../lib/auth/auth-session";
import { authErrorMessage } from "../../lib/auth/neon-auth";
import {
  ADOPT_TIMEOUT_MS,
  adoptSessions,
  anomalyOf,
  reportAdoptionAnomaly,
} from "../../lib/auth/session-adoption";
import type { AdoptionAnomaly, SessionAdoptionOutcome } from "../../lib/auth/session-adoption";

/**
 * `save-failed` is a *successful* login whose create-on-login replay failed. It
 * is reported rather than folded into `done`, because the intent survives a
 * failed replay: reporting a clean login would leave it to fire unannounced on
 * the next login inside its TTL.
 *
 * `adoption-failed` is the same idea for the anonymous-session claim (#507
 * review P1-3). `apps/web` has no telemetry sink, so a log line reaches nobody
 * — the visitor is the only party who can act, and the only real outlet.
 */
export type AuthCallbackState = "pending" | "done" | "error" | "save-failed" | "adoption-failed";
type Establish = () => Promise<string | undefined>;
type Replay = () => Promise<DeferredReplayOutcome>;
type Adopt = (token: string) => Promise<SessionAdoptionOutcome>;
type SetState = (state: AuthCallbackState) => void;

/** `undefined` = landed; `"dismissed"` = the visitor chose to move on. */
type AdoptionState = AdoptionAnomaly | "dismissed" | undefined;

/** One adoption attempt's timeout memory, shared across the initial run and
 * every retry (SESSION-2 #960): a timed-out attempt's outcome is unknown, so a
 * later `"nothing"` may be observing the server landing the earlier one — and
 * must not be flagged as a no-op anomaly. */
interface AdoptionTimeline {
  timedOut: boolean;
}

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

/** Runs `run` under a `ms` timeout, reporting whether the timeout fired so the
 * caller can remember an unknown outcome (SESSION-2 #960). `async` on purpose:
 * a *synchronous* throw from `run` becomes a rejection that `.catch` folds
 * into `onTimeout` — it never rejects the caller. */
async function timedRace<T>(
  run: () => Promise<T>, ms: number, onTimeout: T,
): Promise<{ value: T; timedOut: boolean }> {
  let timedOut = false;
  const value = await Promise.race([
    Promise.resolve().then(run).catch((): T => onTimeout),
    new Promise<T>((resolve) => { setTimeout(() => { timedOut = true; resolve(onTimeout); }, ms); }),
  ]);
  return { value, timedOut };
}

/**
 * Structurally incapable of rejecting (#507 review P2). It rides a
 * `Promise.all` beside the replay, so a throw here would reject the whole
 * `redeem` and report a *successful* login as `"error"`. `adoptSessions`
 * already catches, but relying on a collaborator's internals for that is the
 * fragile version — this makes it a property of the call site, and a
 * throwing-adopt test pins it.
 *
 * A timeout is recorded as `failed` (and remembered in `timeline`). The race
 * does not abort the request, so the server may still succeed afterwards and
 * this becomes a false negative. This is **the one** case the #507 owner
 * ruling actually rescues: under the old edge the server's success would have
 * retired the `aid` cookie, leaving the retry with no identity to present.
 * Every other failure branch already kept its cookie — retirement was gated on
 * success — so "keeping the cookie makes failures recoverable" is true for
 * this timing race and not in general. Either way the retry is the same
 * idempotent `UPDATE`; the remembered timeout lets that retry recognise a
 * late-landed success as success (SESSION-2 #960).
 */
async function runAdoption(
  adopt: Adopt, token: string, expected: boolean, timeline: AdoptionTimeline,
): Promise<AdoptionState> {
  const priorTimeout = timeline.timedOut;
  const { value: outcome, timedOut } = await timedRace(() => adopt(token), ADOPT_TIMEOUT_MS, "failed");
  timeline.timedOut ||= timedOut;
  const anomaly = anomalyOf(outcome, expected, priorTimeout);
  if (anomaly !== undefined) reportAdoptionAnomaly(anomaly);
  return anomaly;
}

interface Collaborators {
  readonly establish: Establish;
  readonly replay: Replay;
  readonly adopt: Adopt;
  readonly expectsAdoption: boolean;
}

interface RedeemResult {
  readonly state: AuthCallbackState;
  readonly adoption: AdoptionState;
  readonly errorMessage?: string;
}

/** Create-on-login: a login the save CTA started replays its deferred intent;
 * any other login (the D8/D11 banners) finds none and saves nothing.
 *
 * The adoption runs **alongside** the replay, not before or after it: they
 * share no data (the adoption re-points `conversations.user_id` in the agent's
 * database; the replay creates a *fresh* route through the users Worker from
 * client-held point ids), and both already hold the token `establish` returned.
 * Serialising them would add the adoption's budget to this interstitial's
 * worst case to buy an ordering nothing depends on. */
async function redeem(c: Collaborators, timeline: AdoptionTimeline): Promise<RedeemResult> {
  const token = await c.establish();
  if (!token) return { state: "error", adoption: undefined };
  const [outcome, adoption] = await Promise.all([
    withTimeout(c.replay, REPLAY_TIMEOUT_MS, FAILED_REPLAY),
    runAdoption(c.adopt, token, c.expectsAdoption, timeline),
  ]);
  return { state: stateFor(outcome), adoption };
}

function failedLogin(error: unknown): RedeemResult {
  return { state: "error", adoption: undefined, errorMessage: authErrorMessage(error) };
}

type SetAdoption = (adoption: AdoptionState) => void;
type SetErrorMessage = (message: string | undefined) => void;

function applyRedeem(
  r: RedeemResult, isActive: boolean,
  setState: SetState, setAdoption: SetAdoption, setError: SetErrorMessage,
): void {
  if (!isActive) return;
  setAdoption(r.adoption);
  setState(r.state);
  setError(r.errorMessage);
}

/** Redeems the token once, dropping the result if the component unmounted first.
 * A rejection is a failed login, not an unhandled promise. */
function establishEffect(
  c: Collaborators, setState: SetState, setAdoption: SetAdoption,
  setError: SetErrorMessage, timeline: AdoptionTimeline,
): () => void {
  let isActive = true;
  void redeem(c, timeline).catch(failedLogin).then((r) => {
    applyRedeem(r, isActive, setState, setAdoption, setError);
  });
  return () => { isActive = false; };
}

function useEstablishOnce(
  c: Collaborators, setState: SetState, setAdoption: SetAdoption,
  setError: SetErrorMessage, timeline: AdoptionTimeline,
): void {
  const { establish, replay, adopt, expectsAdoption } = c;
  useEffect(
    () => establishEffect({ establish, replay, adopt, expectsAdoption }, setState, setAdoption, setError, timeline),
    [establish, replay, adopt, expectsAdoption, setState, setAdoption, setError, timeline],
  );
}

export interface AuthCallbackSession {
  readonly state: AuthCallbackState;
  /** SDK `error.message` when redeem failed; absent on every other state. */
  readonly errorMessage?: string;
  /** Which anomaly the adoption notice is reporting, for its copy. */
  readonly adoption: AdoptionAnomaly | undefined;
  /** Re-run only the create-on-login replay; the session is already redeemed. */
  readonly retrySave: () => void;
  /** Give up on the deferred save *here*; the intent survives for the next login
   * inside its TTL, which is what replays it. */
  readonly dismissSave: () => void;
  /** Re-run only the ownership claim. Safe to repeat: the server-side `UPDATE`
   * matches zero rows the second time, and the `aid` cookie still resolves. */
  readonly retryAdoption: () => void;
  /** Move on without the claim. The anonymous work stays behind that identity,
   * still reachable by a later login. */
  readonly dismissAdoption: () => void;
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
async function retriedAdoption(c: Collaborators, timeline: AdoptionTimeline): Promise<AdoptionState> {
  const token = await c.establish();
  if (!token) return "failed";
  return runAdoption(c.adopt, token, c.expectsAdoption, timeline);
}

/** Completes the retry: the safety catch, then the state write. Extracted so
 * `useRetryAdoption`'s callback body stays within the two-level limit. */
function settleRetry(attempt: Promise<AdoptionState>, setAdoption: SetAdoption): void {
  void attempt
    .catch((): AdoptionState => "failed")
    .then(setAdoption);
}

function useRetryAdoption(c: Collaborators, setAdoption: SetAdoption, timeline: AdoptionTimeline): () => void {
  const { establish, adopt, replay, expectsAdoption } = c;
  return useCallback(() => {
    settleRetry(retriedAdoption({ establish, adopt, replay, expectsAdoption }, timeline), setAdoption);
  }, [establish, adopt, replay, expectsAdoption, setAdoption, timeline]);
}

/** The save surface wins while it is showing: it is the thing the visitor
 * asked for and can act on. The adoption notice takes over once that is
 * settled, so neither failure is swallowed by the other. */
function derivedState(state: AuthCallbackState, adoption: AdoptionState): AuthCallbackState {
  if (state !== "done") return state;
  return adoption === undefined || adoption === "dismissed" ? "done" : "adoption-failed";
}

/**
 * Redeems the Neon Auth session (cookie and/or `neon_auth_session_verifier`)
 * for the app's cached bearer token, then replays a
 * deferred save when the login came from the 「保存する」 CTA, and claims the
 * browser's anonymous sessions for the new account (#507). `establish`,
 * `replay` and `adopt` are injectable for tests; production callers — every
 * magic-link, OTP and OAuth login funnels through here — rely on the defaults.
 *
 * `expectsAdoption` says the login's return target named a chat session, so a
 * `{"adopted": 0}` is an anomaly rather than a normal no-op.
 */
export function useAuthCallback(
  establish: Establish = establishAuthSession, replay: Replay = replayDeferredSave,
  adopt?: Adopt, expectsAdoption = false,
): AuthCallbackSession {
  const resolvedAdopt = adopt ?? adoptSessions;
  return useCallbackSession({ establish, replay, adopt: resolvedAdopt, expectsAdoption });
}

function useCallbackSession(c: Collaborators): AuthCallbackSession {
  const [state, setState] = useState<AuthCallbackState>("pending");
  const [adoption, setAdoption] = useState<AdoptionState>(undefined);
  const [errorMessage, setErrorMessage] = useState<string | undefined>();
  const timeline = useRef<AdoptionTimeline>({ timedOut: false }).current;
  useEstablishOnce(c, setState, setAdoption, setErrorMessage, timeline);
  const surfaced = { state: derivedState(state, adoption), adoption: shown(adoption), errorMessage };
  return { ...surfaced, ...useSaveActions(c.replay, setState), ...useClaimActions(c, setAdoption, timeline) };
}

/** A dismissed notice is gone, not merely hidden: nothing should re-render it. */
function shown(adoption: AdoptionState): AdoptionAnomaly | undefined {
  return adoption === "dismissed" ? undefined : adoption;
}

function useSaveActions(replay: Replay, setState: SetState) {
  return {
    retrySave: useRetrySave(replay, setState),
    dismissSave: useCallback(() => { setState("done"); }, [setState]),
  };
}

function useClaimActions(c: Collaborators, setAdoption: SetAdoption, timeline: AdoptionTimeline) {
  return {
    retryAdoption: useRetryAdoption(c, setAdoption, timeline),
    dismissAdoption: useCallback(() => { setAdoption("dismissed"); }, [setAdoption]),
  };
}
