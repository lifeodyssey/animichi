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

const RATE_LIMIT_MESSAGE = "リクエストが多いみたい。少し待ってね。";

export function rateLimitedResponse(retryAfterSeconds: number): Response {
  const error = { code: "rate_limited", message: RATE_LIMIT_MESSAGE, retry_after_seconds: retryAfterSeconds };
  return new Response(JSON.stringify({ error }), {
    status: 429,
    headers: { "Content-Type": "application/json", "Retry-After": String(retryAfterSeconds) },
  });
}
