/**
 * SUT: the API Worker's request gateway, entered as the Worker is entered. This
 * file pins the exact answer of every refusal, every 404 and every unexpected
 * failure today: the status, the `Content-Type`, the body byte for byte, and the
 * two headers that travel with some of them (`Retry-After` on a rate limit and
 * on an uncheckable credential, `Cache-Control: no-store` on an asset arm's
 * refusal). A framework's own 404 or 500 is plain text; the gateway's are the
 * shared JSON envelope.
 *
 * test-type: characterization
 */
import test from "node:test";
import assert from "node:assert/strict";
import { ADMITTED, entrySeam, HUMAN, UNVERIFIABLE } from "./doubles/entry-seam.ts";
import { LIMITED, UNLIMITED, type LimiterPlan } from "./doubles/entry-seam-limiters.ts";
import {
  CLIENT_SESSION_ID, IMAGE_METHOD_NOT_ALLOWED, IMAGE_NOT_FOUND, IMAGE_PATH_INVALID, IMAGE_PLAN_REQUIRED,
  IMAGE_STORAGE_UNAVAILABLE, INTERNAL_ERROR, METHOD_NOT_ALLOWED, NOT_FOUND, RATE_LIMIT_UNAVAILABLE, RATE_LIMITED_17,
  RATE_LIMITED_60, SHOWCASE_DENIED, TILE_METHOD_NOT_ALLOWED, TILE_NOT_FOUND, TILE_STORAGE_UNAVAILABLE, TURNSTILE_REQUIRED,
  UNAUTHORIZED, UNEXPECTED_QUERY, VERIFICATION_UNAVAILABLE,
} from "./doubles/entry-envelopes.ts";

interface Envelope {
  readonly answer: string;
  readonly method: string;
  readonly path: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly vars: Readonly<Record<string, unknown>>;
  readonly plan: LimiterPlan;
  readonly status: number;
  readonly body: string;
  readonly retryAfter: string | null;
  readonly cacheControl: string | null;
}

const SHARD_DENIES: LimiterPlan = { coarse: Number.POSITIVE_INFINITY, durable: 0 };
const SHARD_DOWN: LimiterPlan = { coarse: Number.POSITIVE_INFINITY, durable: "down" };
const UNREACHABLE = { fetch: () => Promise.reject(new TypeError("binding unreachable")) };

function envelope(answer: string, method: string, path: string, status: number, body: string, more: Partial<Envelope> = {}): Envelope {
  return { answer, method, path, headers: {}, vars: {}, plan: UNLIMITED, status, body, retryAfter: null, cacheControl: null, ...more };
}

const ENVELOPES: readonly Envelope[] = [
  envelope("an unmatched path", "GET", "/unknown", 404, NOT_FOUND),
  envelope("an unmatched path asked with HEAD", "HEAD", "/unknown", 404, ""),
  envelope("an unknown /v1 route", "POST", "/v1/unknown", 404, NOT_FOUND, { headers: HUMAN }),
  envelope("adoption's method gate", "GET", "/v1/sessions/adopt", 405, METHOD_NOT_ALLOWED),
  envelope("an absent credential", "GET", "/v1/users/saved-routes", 401, UNAUTHORIZED),
  envelope("an uncheckable credential", "GET", "/v1/users/saved-routes", 503, VERIFICATION_UNAVAILABLE,
    { headers: UNVERIFIABLE, retryAfter: "30" }),
  envelope("the showcase gate", "GET", "/v1/conversations", 403, SHOWCASE_DENIED, { vars: { EDGE_SHOWCASE_MODE: "true" } }),
  envelope("the Turnstile gate", "POST", "/v1/chat", 403, TURNSTILE_REQUIRED),
  envelope("the coarse damper", "POST", "/v1/chat", 429, RATE_LIMITED_60, { headers: HUMAN, plan: LIMITED, retryAfter: "60" }),
  envelope("the durable shard", "POST", "/v1/chat", 429, RATE_LIMITED_17, { headers: HUMAN, plan: SHARD_DENIES, retryAfter: "17" }),
  envelope("a durable shard outage", "POST", "/v1/chat", 503, RATE_LIMIT_UNAVAILABLE, { headers: HUMAN, plan: SHARD_DOWN }),
  envelope("an undeclared catalog parameter", "GET", "/catalog/public/popular?spoof=1", 400, UNEXPECTED_QUERY),
  envelope("a client session id on adoption", "POST", "/v1/sessions/adopt?session_id=s-1", 400, CLIENT_SESSION_ID,
    { headers: HUMAN }),
  envelope("an image path the proxy refuses", "GET", "/img/a..b", 400, IMAGE_PATH_INVALID),
  envelope("an image with no size plan", "GET", "/img/a.jpg", 400, IMAGE_PLAN_REQUIRED),
  envelope("a tile outside the key grammar", "GET", "/tiles/unknown.txt", 404, TILE_NOT_FOUND, { cacheControl: "no-store" }),
  envelope("a tile asked with POST", "POST", "/tiles/styles/basemap.json", 405, TILE_METHOD_NOT_ALLOWED, { cacheControl: "no-store" }),
  envelope("a tile with its bucket unbound", "GET", "/tiles/styles/basemap.json", 503, TILE_STORAGE_UNAVAILABLE,
    { vars: { MAP_TILES: undefined }, cacheControl: "no-store" }),
  envelope("a docs asset the bucket lacks", "GET", "/img/docs/archive/b.png", 404, IMAGE_NOT_FOUND, { cacheControl: "no-store" }),
  envelope("a docs asset asked with POST", "POST", "/img/docs/archive/a.png", 405, IMAGE_METHOD_NOT_ALLOWED,
    { cacheControl: "no-store" }),
  envelope("a docs asset with its bucket unbound", "GET", "/img/docs/archive/a.png", 503, IMAGE_STORAGE_UNAVAILABLE,
    { vars: { DOCS_ASSETS: undefined }, cacheControl: "no-store" }),
  envelope("an unreachable users binding", "GET", "/v1/users/saved-routes", 500, INTERNAL_ERROR,
    { headers: HUMAN, vars: { USERS: UNREACHABLE } }),
  envelope("an unreachable catalog binding", "GET", "/catalog/public/popular", 500, INTERNAL_ERROR, { vars: { CATALOG: UNREACHABLE } }),
  envelope("a durable class with its guard binding unbound", "POST", "/v1/chat", 503, RATE_LIMIT_UNAVAILABLE,
    { headers: HUMAN, vars: { EDGE_GUARD: undefined } }),
  envelope("an admitted visitor's turn with its guard binding unbound", "POST", "/v1/chat", 503, RATE_LIMIT_UNAVAILABLE,
    { headers: ADMITTED, vars: { EDGE_GUARD: undefined } }),
  envelope("a BYOK probe with its guard binding unbound", "POST", "/v1/byok/probe", 503, RATE_LIMIT_UNAVAILABLE,
    { headers: HUMAN, vars: { EDGE_GUARD: undefined } }),
  envelope("a users write with its guard binding unbound", "POST", "/v1/users/saved-routes", 503, RATE_LIMIT_UNAVAILABLE,
    { headers: HUMAN, vars: { EDGE_GUARD: undefined } }),
  envelope("a users DELETE with its guard binding unbound", "DELETE", "/v1/users/saved-routes", 503, RATE_LIMIT_UNAVAILABLE,
    { headers: HUMAN, vars: { EDGE_GUARD: undefined } }),
  envelope("an adoption with its guard binding unbound", "POST", "/v1/sessions/adopt", 503, RATE_LIMIT_UNAVAILABLE,
    { headers: HUMAN, vars: { EDGE_GUARD: undefined } }),
];

for (const expected of ENVELOPES) {
  void test(`${expected.answer} answers ${String(expected.status)} in the shared JSON envelope`, async (t) => {
    const seam = entrySeam(t, expected.plan, expected.vars);
    const response = await seam.send(expected.method, expected.path, expected.headers);
    assert.equal(response.status, expected.status);
    assert.equal(response.headers.get("Content-Type"), "application/json");
    assert.equal(await response.text(), expected.body);
    assert.equal(response.headers.get("Retry-After"), expected.retryAfter);
    assert.equal(response.headers.get("Cache-Control"), expected.cacheControl);
  });
}
