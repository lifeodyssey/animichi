const PUBLIC_V1 = ["/v1/search/preview", "/v1/bangumi/popular"];
export function isPublicV1(pathname: string): boolean {
  return PUBLIC_V1.includes(pathname) || /^\/v1\/bangumi\/[^/]+\/guide$/.test(pathname);
}

// Per-identity rate limiting on the AUTHENTICATED path (issue #284 / Task 9).
// Previously this branch called no limiter at all; BYOK makes that unbounded
// (free self-serve accounts, an outbound call per turn). Scoped to
// cost-bearing routes only — counting reads (conversations/messages/routes)
// would let paging through history 429 an unrelated in-flight chat turn.
// /v1/runtime + /v1/runtime/stream (agent/interfaces/routes/runtime.py) run
// a full agent turn on the house key, same cost shape as chat — they belong
// here too; retiring these legacy routes is tracked separately.
const AUTH_RATE_LIMITED_EXACT = ["/v1/chat", "/v1/runtime", "/v1/runtime/stream"];
const AUTH_RATE_LIMITED_PREFIX = "/v1/byok/";

/** Strip one trailing slash so "/v1/chat/" counts as "/v1/chat" — a bare
 * exact-match let a trailing slash skip the limiter outright (P2-5). */
function normalizeV1Path(pathname: string): string {
  return pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
}

/**
 * Percent-decode for routing decisions only (review follow-up, #479 P1-1 /
 * #464): `URL.pathname` does NOT decode `%XX` escapes, but the container's
 * ASGI router (uvicorn/Starlette) does before matching its own routes. That
 * split-brain let `/v1/%62yok/probe` read as "not `/v1/byok/`" here — zero
 * `checkRateLimit` calls — while still landing on `handle_byok_probe` in the
 * container: an authenticated caller could burst an unbounded number of real
 * outbound probe calls by percent-encoding one letter per request. Returns
 * `null` on a malformed `%` escape so the caller can fail CLOSED: an
 * unparseable path is exactly the shape an evasion attempt produces, so
 * treating it as "not rate-limited" would recreate the same hole this fixes.
 */
function decodedForRouting(pathname: string): string | null {
  try {
    return decodeURIComponent(pathname);
  } catch {
    return null;
  }
}

/** BYOK routes match by prefix, not an exact list — every route under
 * /v1/byok/ is an outbound relay by construction (P2-5). */
export function isAuthRateLimited(pathname: string): boolean {
  const decoded = decodedForRouting(pathname);
  if (decoded === null) return true;
  const normalized = normalizeV1Path(decoded);
  return AUTH_RATE_LIMITED_EXACT.includes(normalized) || normalized.startsWith(AUTH_RATE_LIMITED_PREFIX);
}

// ── Anonymous /v1 access (issue #274 / S1.8) ───────────────────────────────
//
// The gate is no longer "authenticated or 401": on the anonymous allowlist an
// unauthenticated caller is given a worker-minted identity and forwarded with
// `X-User-Type: anonymous`, subject to a per-identity burst limit and the
// global daily-budget breaker. Everything else still 401s. Keep the allowlist
// narrow — each entry is a surface that costs money without a login.
// Photo-search (issue #260) is anon-metered by design: the container reads the
// worker-asserted X-User-Id/Type for its quota tiering, so both endpoints ride
// the same minted-identity + rate-limit + budget gate as /v1/chat.
const ANON_V1 = ["/v1/chat", "/v1/photo-search", "/v1/photo-search/confirm"];

export function isAnonymousV1(pathname: string): boolean {
  return ANON_V1.includes(pathname);
}
