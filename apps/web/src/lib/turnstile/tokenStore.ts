/**
 * In-memory holder for the current Turnstile token (S1.9 / issue #281).
 *
 * Mirrors the edge's short-lived window (`worker/turnstile.ts`
 * TURNSTILE_WINDOW_MS): one solved challenge covers every message sent inside
 * it, so an anonymous user is not re-challenged per message. Module state
 * only — a reload re-renders the widget and mints a fresh token.
 */

/** Kept a touch under the edge window so the client stops offering a token
 * slightly before the Worker would stop honouring it. */
export const TURNSTILE_TOKEN_TTL_MS = 4 * 60_000;

/** Request header carrying the token — must match `TURNSTILE_HEADER`. */
export const TURNSTILE_HEADER = "cf-turnstile-response";

interface StoredToken {
  readonly token: string;
  readonly expiresAt: number;
}

let stored: StoredToken | undefined;

/** Record a freshly solved token; an empty token clears the store. */
export function rememberTurnstileToken(token: string, now: number = Date.now()): void {
  stored = token === "" ? undefined : { token, expiresAt: now + TURNSTILE_TOKEN_TTL_MS };
}

export function currentTurnstileToken(now: number = Date.now()): string | undefined {
  if (stored === undefined || stored.expiresAt <= now) return undefined;
  return stored.token;
}

export function clearTurnstileToken(): void {
  stored = undefined;
}

/** `{}` unless an unexpired token is held. Anonymous turns only — the caller
 * omits these headers whenever the request carries an Authorization bearer. */
export function turnstileHeaders(now: number = Date.now()): Record<string, string> {
  const token = currentTurnstileToken(now);
  return token === undefined ? {} : { [TURNSTILE_HEADER]: token };
}
