import { authHeaders } from "../../lib/auth/authSession";
import { turnstileHeaders } from "../../lib/turnstile/tokenStore";

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
  const challenge = auth.Authorization === undefined ? turnstileHeaders() : {};
  return { ...base, ...challenge, ...auth };
}
