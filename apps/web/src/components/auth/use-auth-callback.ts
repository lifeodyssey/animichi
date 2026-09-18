import { useCallback, useEffect, useRef, useState } from "react";
import { replayDeferredSave } from "../../features/chat/save/complete-deferred-save";
import type { DeferredReplayOutcome } from "../../features/chat/save/complete-deferred-save";
import { establishAuthSession } from "../../lib/auth/auth-session";
import { authErrorMessage } from "../../lib/auth/neon-auth";
import {
  adoptSessions, reportAdoptionAnomaly, runAdoption,
} from "../../lib/auth/session-adoption";
import type {
  AdoptionAnomaly, AdoptionTimeline, SessionAdoptionOutcome,
} from "../../lib/auth/session-adoption";

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

/** A mount's live flag, read when a retry settles — not when it starts. */
interface MountedRef { readonly current: boolean }

/** `failed`/`nothing-adopted` are the reportable anomalies; a landed or
 * dismissed notice is history, not news (#507 review P1-3). */
function isAnomaly(adoption: AdoptionState): adoption is AdoptionAnomaly {
  return adoption === "failed" || adoption === "nothing-adopted";
}

/** Surfaces an adoption — the anomaly report beside the state write — but only
 * while its screen is still mounted: past unmount, both are moot (#1765). */
function surfaceAdoptionIfActive(
  adoption: AdoptionState, isActive: boolean, setAdoption: SetAdoption,
): void {
  if (!isActive) return;
  if (isAnomaly(adoption)) reportAdoptionAnomaly(adoption);
  setAdoption(adoption);
}

function applyRedeem(
  r: RedeemResult, isActive: boolean,
  setState: SetState, setAdoption: SetAdoption, setError: SetErrorMessage,
): void {
  if (!isActive) return;
  surfaceAdoptionIfActive(r.adoption, isActive, setAdoption);
  setState(r.state);
  setError(r.errorMessage);
}

/** One visit = one redeem, shared per document. React 19.3 StrictMode
 * double-invokes hydration effects (facebook/react#35961): the second effect
 * run used to redeem again behind the first, posting a duplicate
 * `POST /v1/sessions/adopt` ~1 ms later — idempotent, but a noisy `no_rows`,
 * and once the visitor has moved on, an `anomaly=failed` warning with nobody
 * home. An `AbortController` was the alternative and reads as the less honest
 * model: an aborted request can still land server-side (the very unknown the
 * #960 timeout memory exists for), so cancellation would promise more than
 * the transport delivers — and the establish leg runs inside the Neon Auth
 * SDK, which takes no signal. Joining the in-flight redeem makes the
 * duplicate not exist rather than pretending it was cancelled. */
let inFlight: Promise<RedeemResult> | undefined;

/** The visit's #960 timeout memory, scoped like the redeem it belongs to. A
 * per-hook ref cannot hold it: the redeem writes `timedOut` onto whichever
 * instance started it, and the StrictMode remount discards that instance — so
 * the live mount's retry would run with a fresh `timedOut: false` and flag a
 * late-landed `"nothing"` as `nothing-adopted`, losing exactly the unknown the
 * #960 memory exists for. Kept beside `inFlight`, it survives the remount (a
 * join never resets it), is shared by every retry of the visit, and is reset
 * only when a genuinely new visit's redeem starts. */
let visitTimeline: AdoptionTimeline = { timedOut: false };

function redeemOnce(c: Collaborators): Promise<RedeemResult> {
  inFlight ??= startVisit(c);
  return inFlight;
}

function startVisit(c: Collaborators): Promise<RedeemResult> {
  visitTimeline = { timedOut: false };
  return redeem(c, visitTimeline).finally(() => { inFlight = undefined; });
}

/** Redeems the token once per visit, joining any redeem already in flight;
 * an unmounted attach drops the result entirely — state writes and the
 * anomaly report alike. A rejection is a failed login, not an unhandled
 * promise. */
function establishEffect(
  c: Collaborators, setState: SetState, setAdoption: SetAdoption,
  setError: SetErrorMessage,
): () => void {
  let isActive = true;
  void redeemOnce(c).catch(failedLogin).then((r) => {
    applyRedeem(r, isActive, setState, setAdoption, setError);
  });
  return () => { isActive = false; };
}

function useEstablishOnce(
  c: Collaborators, setState: SetState, setAdoption: SetAdoption,
  setError: SetErrorMessage,
): void {
  const { establish, replay, adopt, expectsAdoption } = c;
  useEffect(
    () => establishEffect({ establish, replay, adopt, expectsAdoption }, setState, setAdoption, setError),
    [establish, replay, adopt, expectsAdoption, setState, setAdoption, setError],
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

/** The claim needs a bearer of its own; `establish` re-reads the cached token.
 * The retry reads the visit timeline, not a per-instance copy, so it inherits
 * the initial redeem's timeout memory across a StrictMode remount (#960). */
async function retriedAdoption(c: Collaborators): Promise<AdoptionState> {
  const token = await c.establish();
  if (!token) return "failed";
  return runAdoption(c.adopt, token, c.expectsAdoption, visitTimeline);
}

/** Live while mounted; re-set inside the effect so a StrictMode remount
 * recovers from its own simulated cleanup. */
function useMountedRef(): MountedRef {
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  return mounted;
}

/** Completes the retry: report, safety catch, then the state write. A retry is
 * user-initiated on a live screen but can settle on a gone one, so it surfaces
 * through the same gate as the initial redeem (#1760, #1765). Extracted so
 * `useRetryAdoption`'s callback body stays within the two-level limit. */
function settleRetry(attempt: Promise<AdoptionState>, alive: MountedRef, setAdoption: SetAdoption): void {
  void attempt
    .catch((): AdoptionState => "failed")
    .then((adoption) => { surfaceAdoptionIfActive(adoption, alive.current, setAdoption); });
}

function useRetryAdoption(c: Collaborators, setAdoption: SetAdoption): () => void {
  const alive = useMountedRef();
  const { establish, adopt, replay, expectsAdoption } = c;
  return useCallback(() => {
    settleRetry(retriedAdoption({ establish, adopt, replay, expectsAdoption }), alive, setAdoption);
  }, [establish, adopt, replay, expectsAdoption, alive, setAdoption]);
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
  useEstablishOnce(c, setState, setAdoption, setErrorMessage);
  const surfaced = { state: derivedState(state, adoption), adoption: shown(adoption), errorMessage };
  return { ...surfaced, ...useSaveActions(c.replay, setState), ...useClaimActions(c, setAdoption) };
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

function useClaimActions(c: Collaborators, setAdoption: SetAdoption) {
  return {
    retryAdoption: useRetryAdoption(c, setAdoption),
    dismissAdoption: useCallback(() => { setAdoption("dismissed"); }, [setAdoption]),
  };
}
