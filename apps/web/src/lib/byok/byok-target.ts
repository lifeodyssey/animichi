/** The settings section the BYOK journey lands on. Split out so a router link
 * can pass it as `hash` instead of re-spelling the target (#1337). */
export const BYOK_SETUP_HASH = "api-key";

/** Stable destination shared by every BYOK discovery and login-return path. */
export const BYOK_SETUP_TARGET = `/settings#${BYOK_SETUP_HASH}` as const;
