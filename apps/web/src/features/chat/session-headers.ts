import { configuredTurnstileSiteKey } from "./components/TurnstileGate";
import { authHeaders } from "../../lib/auth/auth-session";
import { byokHeaders } from "../../lib/byok/byok-storage";
import { awaitTurnstileToken, turnstileHeaders } from "../../lib/turnstile/token-store";

/**
 * The Session offer (TURN-4 #955): what the server granted/echoed for the
 * conversation — the live session id, the CAS revision, and the canonical
 * digest of the persisted session envelope. The web echoes all three back on
 * the next turn so admission can reject stale/concurrent requests.
 */
export interface SessionOffer {
  readonly sessionId?: string;
  readonly revision?: number;
  readonly digest?: string;
  /** One fresh turn identifier per send (`x-turn-id`, TURN-4 #955). */
  readonly turnId?: string;
}

/**
 * Shared /v1 transport headers: the Session offer (`x-session-id`,
 * `x-session-revision`, `x-session-digest` — when known) plus a Bearer
 * token once signed in; anonymous turns simply omit Authorization and instead
 * carry the held Turnstile token (S1.9 #281) — one solved challenge covers
 * every turn in its window.
 *
 * A saved BYOK credential (#284 Task 6) adds its `X-BYOK-*` headers on top of
 * every caller of this function — deliberately, not by omission: T9 requires a
 * BYOK turn to never silently fall back to the platform key, and the chat turn
 * is that rule's whole remaining surface. `byokHeaders()` returns `{}` with
 * nothing saved, so this is a no-op for every caller until a credential exists.
 * It is read synchronously and does not participate in the Turnstile wait below
 * in any way — its ordering relative to that wait has no observable effect.
 * (`photo-search` was the second caller this header path was shared with until
 * #1604 deleted that surface.)
 */
export async function sessionHeaders(offer?: SessionOffer): Promise<Record<string, string>> {
  const base: Record<string, string> = {};
  if (offer?.sessionId) base["x-session-id"] = offer.sessionId;
  if (offer?.revision !== undefined) base["x-session-revision"] = String(offer.revision);
  if (offer?.digest) base["x-session-digest"] = offer.digest;
  if (offer?.turnId) base["x-turn-id"] = offer.turnId;
  const auth = await authHeaders();
  const challenge = await challengeHeaders(auth);
  return { ...base, ...challenge, ...auth, ...byokHeaders() };
}

/**
 * Wait for the widget rather than walking into a 403 (issue #447 review).
 *
 * The edge challenges every anonymous `/v1` turn on the allowlist, which is chat
 * alone since #1604 deleted the photo search surface, so a request fired before
 * the widget has solved is rejected with a retryable challenge. Skipped
 * entirely once authenticated — the same short-circuit the pre-wait version
 * of this function had.
 *
 * When this build renders no widget there is nothing to wait for, so the
 * request goes out immediately and any rejection surfaces normally. The wait
 * itself is bounded (`TURNSTILE_WAIT_MS`) — it delays a turn, it never hangs
 * one.
 */
async function challengeHeaders(auth: Record<string, string>): Promise<Record<string, string>> {
  if (auth.Authorization !== undefined) return {};
  if (configuredTurnstileSiteKey() !== undefined) await awaitTurnstileToken();
  return turnstileHeaders();
}
