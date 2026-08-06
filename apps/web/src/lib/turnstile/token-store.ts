import {
  TURNSTILE_HEADER,
  TURNSTILE_TOKEN_TTL_MS,
} from "@animichi/contract/constants";

export { TURNSTILE_HEADER, TURNSTILE_TOKEN_TTL_MS };

/**
 * In-memory holder for the current Turnstile token (S1.9 / issue #281).
 *
 * One solved challenge covers every message inside the shared contract's
 * short-lived window, so an anonymous user is not re-challenged per message.
 * Module state only — a reload re-renders the widget and mints a fresh token.
 */

interface StoredToken {
  readonly token: string;
  readonly expiresAt: number;
}

let stored: StoredToken | undefined;

type TokenListener = (token: string) => void;
const listeners = new Set<TokenListener>();

/** How long a caller waits for the widget to hand over a fresh token before
 * giving up. Solving is usually instant; an interactive challenge is not. */
export const TURNSTILE_WAIT_MS = 15_000;

/** Subscribe to solved tokens; returns the unsubscribe. */
export function onTurnstileToken(listener: TokenListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Record a freshly solved token; an empty token clears the store. */
export function rememberTurnstileToken(token: string, now: number = Date.now()): void {
  stored = token === "" ? undefined : { token, expiresAt: now + TURNSTILE_TOKEN_TTL_MS };
  if (stored !== undefined) for (const listener of [...listeners]) listener(token);
}

export function currentTurnstileToken(now: number = Date.now()): string | undefined {
  if (stored === undefined || stored.expiresAt <= now) return undefined;
  return stored.token;
}

/** Waiters parked in `awaitTurnstileToken`, each with its own timeout. */
const waiting = new Set<() => void>();

/**
 * Drop the held token and abandon anyone still waiting for one. Cancelling the
 * waiters matters as much as clearing the token: each holds a pending timer,
 * and a caller parked on a widget that will never solve (the page navigated
 * away, the challenge was abandoned) would otherwise linger for the full
 * timeout.
 */
export function clearTurnstileToken(): void {
  stored = undefined;
  for (const abandon of [...waiting]) abandon();
}

function releaseWaiter(abandon: () => void, timer: ReturnType<typeof setTimeout>, stop: () => void): void {
  stop();
  clearTimeout(timer);
  waiting.delete(abandon);
}

function waitForToken(timeoutMs: number, resolve: (token: string | undefined) => void): void {
  const settle = (token: string | undefined) => { releaseWaiter(abandon, timer, stop); resolve(token); };
  const abandon = () => { settle(undefined); };
  const timer = setTimeout(abandon, timeoutMs);
  const stop = onTurnstileToken(settle);
  waiting.add(abandon);
}

/**
 * The token to send with the next anonymous turn: the held one, or the next
 * the widget solves, or `undefined` once the wait elapses. Callers use this so
 * a request is never sent tokenless into an armed edge (issue #447 review).
 */
export function awaitTurnstileToken(timeoutMs: number = TURNSTILE_WAIT_MS): Promise<string | undefined> {
  const held = currentTurnstileToken();
  if (held !== undefined) return Promise.resolve(held);
  return new Promise<string | undefined>((resolve) => { waitForToken(timeoutMs, resolve); });
}

/** `{}` unless an unexpired token is held. Anonymous turns only — the caller
 * omits these headers whenever the request carries an Authorization bearer. */
export function turnstileHeaders(now: number = Date.now()): Record<string, string> {
  const token = currentTurnstileToken(now);
  return token === undefined ? {} : { [TURNSTILE_HEADER]: token };
}
