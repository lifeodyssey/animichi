import { configuredTurnstileSiteKey } from "../../components/TurnstileGate";
import { authHeaders } from "../../lib/auth/authSession";
import { byokHeaders } from "../../lib/byok/byokStorage";
import { awaitTurnstileToken, turnstileHeaders } from "../../lib/turnstile/tokenStore";

/**
 * Shared /v1 transport headers: `x-session-id` (when known) plus a Bearer
 * token once signed in; anonymous turns simply omit Authorization and instead
 * carry the held Turnstile token (S1.9 #281) — one solved challenge covers
 * every turn in its window. Used by the chat transport and photo search so
 * both surfaces hit the edge with identical identity semantics.
 *
 * A saved BYOK credential (#284 Task 6) adds its `X-BYOK-*` headers on top of
 * every caller of this function — deliberately, not by omission. Photo
 * search's vision probe/badge (Task 5, D5) exists precisely so a BYOK user's
 * image turns are answered by their own key; T9 requires a BYOK turn to
 * never silently fall back to the platform key, so photo search inheriting
 * the same headers as chat is the correct semantics, not an accident of
 * sharing this module. `byokHeaders()` returns `{}` with nothing saved, so
 * this is a no-op for every caller until a credential exists. It is read
 * synchronously and does not participate in the Turnstile wait below in any
 * way — its ordering relative to that wait has no observable effect.
 */
export async function sessionHeaders(sessionId?: string): Promise<Record<string, string>> {
  const base: Record<string, string> = sessionId ? { "x-session-id": sessionId } : {};
  const auth = await authHeaders();
  const challenge = await challengeHeaders(auth);
  return { ...base, ...challenge, ...auth, ...byokHeaders() };
}

/**
 * Wait for the widget rather than walking into a 403 (issue #447 review).
 *
 * The edge challenges every anonymous `/v1` turn on the allowlist — chat AND
 * photo search (#445 added `/v1/photo-search` to it) — so a request fired
 * before the widget has solved is rejected. Chat surfaces that as a retryable
 * challenge; photo upload has no challenge UI of its own, which is exactly why
 * the wait lives here, in the header path both surfaces share. Skipped
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
