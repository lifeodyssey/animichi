import type { AuthFailure } from "../identity/auth.ts";

/**
 * The ONE envelope every edge rejection answers in (EG-05, issue #1343):
 * `{ error: { code, message? } }`.
 *
 * `apps/web`'s error classifier branches on `error.code`, so a flat
 * `{ error: "…" }` or a plain-text body is not a rejection it can read — and
 * this file has claimed since #537 that "one client parser covers the whole
 * surface" while six sites answered their own shape beside it. Every rejection
 * on this Worker is built here or through `gatewayRejection` at its own site.
 *
 * `message` is optional because some refusals (a tile that is not there) carry
 * nothing a client would render; the CODE never is. The `{ detail }` shapes in
 * `agent-turn-responses.ts` are deliberately NOT this envelope: they mirror the
 * Python routes the turn tier replaced, and they retire with W4.
 */
export function gatewayRejection(code: string, status: number, message?: string): Response {
  return Response.json({ error: message === undefined ? { code } : { code, message } }, { status });
}

const VALID_CREDENTIALS_MESSAGE = "Valid credentials required.";

/** The credential-ABSENT 401: the caller offered nothing this gateway could
 * verify. Deliberately unlogged — on a surface that serves anonymous callers an
 * absent credential is a normal event, while an INVALID one is the #441 signal
 * `unauthorized` below records. */
export function credentialsRequired(): Response {
  return gatewayRejection("unauthorized", 401, VALID_CREDENTIALS_MESSAGE);
}

/** Structured, credential-free record of a rejected credential (issue #441).
 *
 * #441 itself only surfaced through anomalous anonymous spend. Its inverse — a
 * 401 storm from a mis-issued or mis-refreshed token — must not be equally
 * invisible, so every `invalid` verdict is counted at the edge. The token, the
 * header and the identity are deliberately absent from the record. */
function logInvalidCredential(pathname: string): void {
  console.warn(JSON.stringify({ event: "edge_auth_invalid_credential", path: pathname }));
}

export function unauthorized(pathname: string): Response {
  logInvalidCredential(pathname);
  return credentialsRequired();
}

const VERIFICATION_UNAVAILABLE_MESSAGE =
  "Credentials could not be verified right now. Please retry; do not discard them.";

/** How long a client should wait before presenting the same credential again.
 * Advisory and deliberately short: the resolver re-attempts the JWKS on the very
 * next request, so this only has to stop a client retry loop, not pace the
 * server's own recovery. */
const VERIFICATION_RETRY_AFTER_SECONDS = 30;

/** Structured, credential-free record of a credential we could not check
 * (issue #452). Its 401 sibling counts a 401 storm; this one exists so that the
 * other thing which produces one — the JWKS being unreachable — is not read as
 * the same event. `detail` says which acquisition failure it was, and no token,
 * header or identity is anywhere near it. */
function logVerificationUnavailable(pathname: string, detail: string): void {
  console.warn(JSON.stringify({ event: "edge_auth_verification_unavailable", path: pathname, detail }));
}

/** The credential could not be CHECKED (issue #452): the key set the verdict
 * needs never arrived. 503 rather than 401 because 401 is the client's D8 signal
 * to clear its token and mint another, which — against the same outage — is a
 * refresh loop; `Retry-After` and the typed code say "come back" instead. No
 * `WWW-Authenticate` challenge goes out: the credential was never shown to be
 * bad. Built beside `rateLimitedResponse` rather than through `gatewayRejection`
 * for the same reason — it extends the envelope with a header, not a field. */
export function verificationUnavailable(pathname: string, detail: string): Response {
  logVerificationUnavailable(pathname, detail);
  const error = { code: "verification_unavailable", message: VERIFICATION_UNAVAILABLE_MESSAGE };
  return new Response(JSON.stringify({ error }), {
    status: 503,
    headers: { "Content-Type": "application/json", "Retry-After": String(VERIFICATION_RETRY_AFTER_SECONDS) },
  });
}

/** The one branch every presented credential fails through (issues #441, #452):
 * a rejected credential logs the storm record, an absent one is a flat 401, and
 * one we could not check is the 503 the client retries rather than
 * re-authenticates. Shared by the gateway's three credential sites and the agent
 * tier's ladder so the three reasons cannot drift apart between them. */
export function authenticationRejection(request: Request, auth: AuthFailure): Response {
  const { pathname } = new URL(request.url);
  if (auth.reason === "unverifiable") return verificationUnavailable(pathname, auth.detail);
  return auth.reason === "invalid" ? unauthorized(pathname) : credentialsRequired();
}

/** Showcase-mode denial (S0-v2 GOAL C / C9): in showcase mode the edge
 * answers every functional backend route with 403 in the same structured
 * envelope as the other rejections, so a direct curl cannot reach chat /
 * user data while the landing stays up. The code is distinct
 * from `not_found` on purpose: clients can tell "this route is temporarily
 * denied" from "this route does not exist". */
export function showcaseDenied(): Response {
  return gatewayRejection("showcase_denied", 403, "Not available in showcase mode.");
}

const RATE_LIMIT_MESSAGE = "リクエストが多いみたい。少し待ってね。";

/** The one rejection that EXTENDS the envelope rather than being built from it:
 * `retry_after_seconds` is a documented third field of this error object
 * (`RATE_LIMIT_ENVELOPE_FIELDS`) and the same number is also a header. */
export function rateLimitedResponse(retryAfterSeconds: number): Response {
  const error = { code: "rate_limited", message: RATE_LIMIT_MESSAGE, retry_after_seconds: retryAfterSeconds };
  return new Response(JSON.stringify({ error }), {
    status: 429,
    headers: { "Content-Type": "application/json", "Retry-After": String(retryAfterSeconds) },
  });
}

/** The fail-CLOSED rejection for a class whose durable limiter is unavailable
 * (`#680` AC4). A 503 (typed `rate_limit_unavailable`) tells the client the
 * request did NOT execute and may be retried — distinct from a `429`
 * `rate_limited` (the burst window was exceeded) and from any `quota_*`
 * code, so the three meter kinds stay separable on the wire. */
export function rateLimitUnavailableResponse(): Response {
  return gatewayRejection("rate_limit_unavailable", 503, "Rate limiter temporarily unavailable. Please retry.");
}

/** Issue #537: with the OpenNext catch-all gone, an unmatched path has no
 * owner on this Worker. It answers a hard 404 in the same envelope as every
 * other edge rejection (`unauthorized`, `rate_limited`). Deliberately NOT a
 * friendly 200 "this is an API gateway" page: that is a soft-404 — crawlers
 * index it and clients cannot branch on it. */
export function notFoundResponse(): Response {
  return gatewayRejection("not_found", 404, "No route matches this request.");
}

/** Method gate for the POST-only session-adoption route (SESSION-2 #960): a
 * 405 in the same envelope as the other edge rejections, answered before any
 * downstream binding is reached. */
export function methodNotAllowed(): Response {
  return gatewayRejection("method_not_allowed", 405, "Method not allowed.");
}

/** What an unexpected throw answers with (EG-06, issue #1343): the same
 * envelope, and a message that says only that the gateway failed. The thrown
 * error's own message never reaches the client — it is a server-side string
 * that may name a binding, a DSN or a stack. */
export function internalError(): Response {
  return gatewayRejection("internal_error", 500, "The gateway could not complete this request.");
}
