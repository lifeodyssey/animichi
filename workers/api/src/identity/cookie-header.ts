/**
 * How this Worker reads its own cookies (`aid`, `turnstile_pass`) out of a
 * request's `Cookie` header: split on ";", trim each pair, and take the value
 * of each `name=value` pair whose name is exactly `name`, as written — no
 * unquoting, no percent-decoding, no trimming around the "=".
 *
 * A request may carry several pairs of one name. The cookie is the first value
 * that the reader's own verification accepts, so a garbage or forged value in
 * front of a valid one is passed over; no lighter test picks a value before it
 * is verified.
 *
 * It stays hand-written because Hono's parser (`hono/cookie`, whose `parse` in
 * `utils/cookie.js` trims names and values, unquotes, decodes and keeps one
 * value per name) cannot offer the values a valid cookie may follow, and
 * accepts cookies this Worker refuses; `test/gateway-entry-cookie-parsing.test.ts`
 * pins each difference.
 */

/** How many values of one name are tried, in header order and whatever their
 * shape; later ones are never verified. A try may compute a signature, before
 * the per-visitor limiter can act, so the scan bounds the work one request can
 * ask for. */
const CANDIDATE_LIMIT = 3;

function cookieCandidates(request: Request, name: string): string[] {
  return (request.headers.get("Cookie") ?? "").split(";")
    .map((part) => part.trim().split("="))
    .filter(([key, ...value]) => key === name && value.length > 0)
    .slice(0, CANDIDATE_LIMIT)
    .map(([, ...value]) => value.join("="));
}

/** What `verify` resolves for the first of the cookie's candidate values it
 * accepts, or null when it accepts none. */
export async function firstVerifiedCookie<T>(
  request: Request, name: string, verify: (value: string) => Promise<T | null>,
): Promise<T | null> {
  for (const value of cookieCandidates(request, name)) {
    const verified = await verify(value);
    if (verified !== null) return verified;
  }
  return null;
}
