export const UNAUTHORIZED_BODY = {
  error: { code: "unauthorized", message: "Valid credentials required." },
} as const;

/** Issue #537: with the OpenNext catch-all gone, an unmatched path has no
 * owner on this Worker. It answers a hard 404 in the same envelope as every
 * other edge rejection (`unauthorized`, `rate_limited`) so one client parser
 * covers the whole surface. Deliberately NOT a friendly 200 "this is an API
 * gateway" page: that is a soft-404 — crawlers index it and clients cannot
 * branch on it. Also reached via `c.notFound()` on the explicit
 * `/catalog/public/*` deny, keeping both paths on one shape. */
export const NOT_FOUND_BODY = {
  error: { code: "not_found", message: "No route matches this request." },
} as const;

/** Method gate for the POST-only session-adoption route (SESSION-2 #960): a
 * 405 in the same envelope as the other edge rejections, answered before the
 * container is reached. */
export const METHOD_NOT_ALLOWED_BODY = {
  error: { code: "method_not_allowed", message: "Method not allowed." },
} as const;

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
  return Response.json(UNAUTHORIZED_BODY, { status: 401 });
}

/** Showcase-mode denial (S0-v2 GOAL C / C9): in showcase mode the edge
 * answers every functional backend route with 403 in the same structured
 * envelope as the other rejections, so a direct curl cannot reach chat /
 * photo-search / user data while the landing stays up. The code is distinct
 * from `not_found` on purpose: clients can tell "this route is temporarily
 * denied" from "this route does not exist". */
export const SHOWCASE_DENIED_BODY = {
  error: { code: "showcase_denied", message: "Not available in showcase mode." },
} as const;

export function showcaseDenied(): Response {
  return Response.json(SHOWCASE_DENIED_BODY, { status: 403 });
}

const RATE_LIMIT_MESSAGE = "リクエストが多いみたい。少し待ってね。";

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
export const RATE_LIMIT_UNAVAILABLE_BODY = {
  error: { code: "rate_limit_unavailable", message: "Rate limiter temporarily unavailable. Please retry." },
} as const;

export function rateLimitUnavailableResponse(): Response {
  return Response.json(RATE_LIMIT_UNAVAILABLE_BODY, { status: 503 });
}
