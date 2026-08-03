/** Owner-sign-off cap for deterministic anime-resolution candidates. */
export const MAX_CANDIDATES = 6;

/** Header carrying a browser-solved Turnstile token to the edge gate. */
export const TURNSTILE_HEADER = "cf-turnstile-response";

/** How long the edge reuses a successful Turnstile verification. */
export const TURNSTILE_WINDOW_MS = 5 * 60_000;

/** Stop offering a token one minute before the edge pass window closes. */
export const TURNSTILE_TOKEN_TTL_MS = TURNSTILE_WINDOW_MS - 60_000;
