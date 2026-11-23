/**
 * SUT: the API Worker's request gateway, entered as the Worker is entered. This
 * file pins the whole response header set today — every header but the varying
 * `X-Request-Id` — for a simple request and a preflight from the web app's own
 * origin, from another origin and with no origin, on each surface.
 *
 * Only the two private asset arms answer CORS: `*`, the fixed method list
 * `GET, HEAD, OPTIONS`, `Range` as the one allowed request header whatever a
 * preflight asks for, `Vary: Origin` always, the exposed range headers only to a
 * caller that named an origin, and the arm's cache lifetime on a preflight. The
 * Anitabi arm adds `Access-Control-Allow-Origin: *` to an image it served and
 * proxies a preflight as an image; its refusals carry nothing. No other surface
 * answers any CORS header. The users prefix answers OPTIONS itself, a 204 that
 * names in `Allow` the methods the users contract declares; any other surface
 * answers a preflight as that route answers OPTIONS. There is no origin
 * allowlist, so the web app's origin and any other origin get identical sets.
 *
 * test-type: characterization
 */
import test from "node:test";
import assert from "node:assert/strict";
import { entrySeam, HUMAN } from "./doubles/entry-seam.ts";

type HeaderSet = readonly (readonly [string, string])[];

const ALLOWED = { Origin: "https://animichi.test" };
const DISALLOWED = { Origin: "https://elsewhere.example" };
const ASK_GET = { "Access-Control-Request-Method": "GET" };
const ASK_RANGE = { ...ASK_GET, "Access-Control-Request-Headers": "range" };
const ASK_MORE = { "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "authorization, content-type" };

const TILE_GET: HeaderSet = [["accept-ranges", "bytes"], ["access-control-allow-headers", "Range"],
  ["access-control-allow-methods", "GET, HEAD, OPTIONS"], ["access-control-allow-origin", "*"],
  ["access-control-expose-headers", "Accept-Ranges, Content-Length, Content-Range, ETag"],
  ["cache-control", "public, max-age=86400, immutable"], ["content-length", "13"], ["content-type", "application/json"],
  ["etag", "etag-style"], ["vary", "Origin"]];
const TILE_GET_NO_ORIGIN: HeaderSet = [["accept-ranges", "bytes"], ["access-control-allow-headers", "Range"],
  ["access-control-allow-methods", "GET, HEAD, OPTIONS"], ["access-control-allow-origin", "*"],
  ["cache-control", "public, max-age=86400, immutable"], ["content-length", "13"], ["content-type", "application/json"],
  ["etag", "etag-style"], ["vary", "Origin"]];
const TILE_PREFLIGHT: HeaderSet = [["access-control-allow-headers", "Range"], ["access-control-allow-methods", "GET, HEAD, OPTIONS"],
  ["access-control-allow-origin", "*"], ["access-control-expose-headers", "Accept-Ranges, Content-Length, Content-Range, ETag"],
  ["cache-control", "public, max-age=86400, immutable"], ["vary", "Origin"]];
const TILE_PREFLIGHT_NO_ORIGIN: HeaderSet = [["access-control-allow-headers", "Range"],
  ["access-control-allow-methods", "GET, HEAD, OPTIONS"], ["access-control-allow-origin", "*"],
  ["cache-control", "public, max-age=86400, immutable"], ["vary", "Origin"]];
const TILE_REFUSAL: HeaderSet = [["access-control-allow-headers", "Range"], ["access-control-allow-methods", "GET, HEAD, OPTIONS"],
  ["access-control-allow-origin", "*"], ["access-control-expose-headers", "Accept-Ranges, Content-Length, Content-Range, ETag"],
  ["cache-control", "no-store"], ["content-type", "application/json"], ["vary", "Origin"]];
const DOCS_GET: HeaderSet = [["accept-ranges", "bytes"], ["access-control-allow-headers", "Range"],
  ["access-control-allow-methods", "GET, HEAD, OPTIONS"], ["access-control-allow-origin", "*"],
  ["access-control-expose-headers", "Accept-Ranges, Content-Length, Content-Range, ETag"],
  ["cache-control", "public, max-age=604800, s-maxage=2592000"], ["content-length", "9"], ["content-type", "image/png"],
  ["etag", "etag-png"], ["vary", "Origin"]];
const DOCS_PREFLIGHT: HeaderSet = [["access-control-allow-headers", "Range"], ["access-control-allow-methods", "GET, HEAD, OPTIONS"],
  ["access-control-allow-origin", "*"], ["access-control-expose-headers", "Accept-Ranges, Content-Length, Content-Range, ETag"],
  ["cache-control", "public, max-age=604800, s-maxage=2592000"], ["vary", "Origin"]];
const IMAGE: HeaderSet = [["access-control-allow-origin", "*"], ["cache-control", "public, max-age=604800, s-maxage=2592000"],
  ["content-type", "image/jpeg"]];
const JSON_ONLY: HeaderSet = [["content-type", "application/json"]];
/** The methods `usersContract` (`packages/contract/src/users-contract.ts`) declares under `/v1/users/`
 * — GET and POST on `saved-routes`, DELETE on `saved-routes/{id}` — in declaration order, with the
 * HEAD a GET route also answers beside GET and the OPTIONS the gateway answers itself last. */
const USERS_OPTIONS: HeaderSet = [["allow", "GET, HEAD, POST, DELETE, OPTIONS"]];

type Answered = readonly [answer: string, method: string, path: string, headers: Readonly<Record<string, string>>,
  status: number, set: HeaderSet];

const ANSWERED: readonly Answered[] = [
  ["a tile, to the web app's origin", "GET", "/tiles/styles/basemap.json", ALLOWED, 200, TILE_GET],
  ["a tile, to another origin", "GET", "/tiles/styles/basemap.json", DISALLOWED, 200, TILE_GET],
  ["a tile, to no origin", "GET", "/tiles/styles/basemap.json", {}, 200, TILE_GET_NO_ORIGIN],
  ["a tile preflight asking no headers", "OPTIONS", "/tiles/styles/basemap.json", { ...ALLOWED, ...ASK_GET }, 204, TILE_PREFLIGHT],
  ["a tile preflight asking for Range", "OPTIONS", "/tiles/styles/basemap.json", { ...ALLOWED, ...ASK_RANGE }, 204, TILE_PREFLIGHT],
  ["a tile preflight from another origin asking more", "OPTIONS", "/tiles/styles/basemap.json", { ...DISALLOWED, ...ASK_MORE }, 204,
    TILE_PREFLIGHT],
  ["a tile OPTIONS with no origin", "OPTIONS", "/tiles/styles/basemap.json", ASK_GET, 204, TILE_PREFLIGHT_NO_ORIGIN],
  ["a tile refusal", "GET", "/tiles/unknown.txt", ALLOWED, 404, TILE_REFUSAL],
  ["a docs asset, to the web app's origin", "GET", "/img/docs/archive/a.png", ALLOWED, 200, DOCS_GET],
  ["a docs asset, to another origin", "GET", "/img/docs/archive/a.png", DISALLOWED, 200, DOCS_GET],
  ["a docs preflight asking for Range", "OPTIONS", "/img/docs/archive/a.png", { ...ALLOWED, ...ASK_RANGE }, 204, DOCS_PREFLIGHT],
  ["an Anitabi image, to the web app's origin", "GET", "/img/a.jpg?plan=h160", ALLOWED, 200, IMAGE],
  ["an Anitabi image, to another origin", "GET", "/img/a.jpg?plan=h160", DISALLOWED, 200, IMAGE],
  ["an Anitabi image, to no origin", "GET", "/img/a.jpg?plan=h160", {}, 200, IMAGE],
  ["an Anitabi image preflight, proxied as the image", "OPTIONS", "/img/a.jpg?plan=h160", { ...ALLOWED, ...ASK_RANGE }, 200, IMAGE],
  ["an Anitabi refusal", "GET", "/img/a.jpg", ALLOWED, 400, JSON_ONLY],
  ["a preflight to the turn", "OPTIONS", "/v1/chat", { ...ALLOWED, ...ASK_MORE }, 404, JSON_ONLY],
  ["a preflight to the turn from another origin", "OPTIONS", "/v1/chat", { ...DISALLOWED, ...ASK_MORE }, 404, JSON_ONLY],
  ["a verified turn", "POST", "/v1/chat", { ...ALLOWED, ...HUMAN }, 200, JSON_ONLY],
  ["a preflight to users", "OPTIONS", "/v1/users/saved-routes", { ...ALLOWED, ...ASK_MORE }, 204, USERS_OPTIONS],
  ["a preflight to users that carries a bearer", "OPTIONS", "/v1/users/saved-routes", { ...ALLOWED, ...ASK_MORE, ...HUMAN }, 204,
    USERS_OPTIONS],
  ["a verified users read", "GET", "/v1/users/saved-routes", { ...ALLOWED, ...HUMAN }, 200, [["content-type", "text/plain"]]],
  ["a public catalog read", "GET", "/catalog/public/popular", ALLOWED, 200, JSON_ONLY],
  ["a preflight to the public catalog", "OPTIONS", "/catalog/public/popular", { ...ALLOWED, ...ASK_GET }, 404, JSON_ONLY],
  ["the readiness probe", "GET", "/healthz", ALLOWED, 200, JSON_ONLY],
  ["a preflight to the readiness probe", "OPTIONS", "/healthz", { ...ALLOWED, ...ASK_GET }, 404, JSON_ONLY],
];

for (const [answer, method, path, headers, status, set] of ANSWERED) {
  void test(`${answer} answers ${String(status)} with today's exact header set`, async (t) => {
    const seam = entrySeam(t);
    const response = await seam.send(method, path, headers);
    assert.equal(response.status, status);
    assert.ok(response.headers.has("X-Request-Id"));
    assert.deepEqual([...response.headers].filter(([name]) => name !== "x-request-id"), set);
  });
}
