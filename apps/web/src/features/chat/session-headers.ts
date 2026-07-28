import { authHeaders } from "../../lib/auth/authSession";
import { configuredTurnstileSiteKey } from "../../components/TurnstileGate";
import { awaitTurnstileToken, turnstileHeaders } from "../../lib/turnstile/tokenStore";

/**
 * Shared /v1 transport headers: `x-session-id` (when known) plus a Bearer
 * token once signed in; anonymous turns simply omit Authorization and instead
 * carry the held Turnstile token (S1.9 #281) — one solved challenge covers
 * every turn in its window. Used by the chat transport and photo search so
 * both surfaces hit the edge with identical identity semantics.
 */
export async function sessionHeaders(sessionId?: string): Promise<Record<string, string>> {
  const base: Record<string, string> = sessionId ? { "x-session-id": sessionId } : {};
  const auth = await authHeaders();
  if (auth.Authorization !== undefined) return { ...base, ...auth };
  return { ...base, ...(await challengeHeaders()) };
}

/**
 * Wait for the widget rather than walking into a 403 (issue #447 review).
 *
 * The edge challenges every anonymous `/v1` turn on the allowlist — chat AND
 * photo search (#445 added `/v1/photo-search` to it) — so a request fired
 * before the widget has solved is rejected. Chat surfaces that as a retryable
 * challenge; photo upload has no challenge UI of its own, which is exactly why
 * the wait lives here, in the header path both surfaces share.
 *
 * When this build renders no widget there is nothing to wait for, so the
 * request goes out immediately and any rejection surfaces normally. The wait
 * itself is bounded (`TURNSTILE_WAIT_MS`) — it delays a turn, it never hangs
 * one.
 */
async function challengeHeaders(): Promise<Record<string, string>> {
  if (configuredTurnstileSiteKey() !== undefined) await awaitTurnstileToken();
  return turnstileHeaders();
}
