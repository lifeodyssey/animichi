/**
 * How this Worker reads its own cookies (`aid`, `turnstile_pass`) out of a
 * request's `Cookie` header: split on ";", trim each pair, and take the value of
 * the FIRST `name=value` pair whose name is exactly `name`, as written — no
 * unquoting, no percent-decoding, no trimming around the "=".
 *
 * It stays hand-written because Hono's parser (`hono/cookie`, whose `parse` in
 * `utils/cookie.js` trims names and values, unquotes, decodes and skips an
 * invalid first duplicate) accepts cookies this Worker refuses today;
 * `test/gateway-entry-cookie-parsing.test.ts` pins each difference.
 */
export function readCookie(request: Request, name: string): string | null {
  for (const part of (request.headers.get("Cookie") ?? "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name && rest.length > 0) return rest.join("=");
  }
  return null;
}
