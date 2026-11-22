/**
 * SUT: the API Worker's request gateway, entered as the Worker is entered. This
 * file pins where the showcase gate sits today: it is the first gate after route
 * selection. In showcase mode a request of a functional class — anything under
 * `/v1`, known or not, the retired migration path, and a GET of the public
 * catalog — answers 403 before the method gate, identity, Turnstile, the query
 * check or any limiter is consulted, with every limiter exhausted to show none
 * was. The landing assets and paths of no class are never denied: `/healthz`
 * only as a GET, the `/tiles/` and `/img/` prefixes for any method, and every
 * unmatched path keeps its 404.
 *
 * Only the literal "false" opens the functional routes; any other value fails
 * closed.
 *
 * test-type: characterization
 */
import test from "node:test";
import assert from "node:assert/strict";
import { entrySeam, HUMAN } from "./doubles/entry-seam.ts";
import { LIMITED } from "./doubles/entry-seam-limiters.ts";
import { NOT_FOUND, SHOWCASE_DENIED, TILE_METHOD_NOT_ALLOWED } from "./doubles/entry-envelopes.ts";

const CALLERS = { "a verified caller": HUMAN, "a caller with no credential": {} };

type Gated = readonly [showcase: string, method: string, path: string, caller: keyof typeof CALLERS,
  status: number, body: string, log: readonly string[]];

const GATED: readonly Gated[] = [
  ["true", "POST", "/v1/chat", "a verified caller", 403, SHOWCASE_DENIED, []],
  ["true", "POST", "/v1/chat", "a caller with no credential", 403, SHOWCASE_DENIED, []],
  ["true", "GET", "/v1/users/saved-routes", "a caller with no credential", 403, SHOWCASE_DENIED, []],
  ["true", "POST", "/v1/sessions/adopt", "a verified caller", 403, SHOWCASE_DENIED, []],
  ["true", "GET", "/v1/sessions/adopt", "a verified caller", 403, SHOWCASE_DENIED, []],
  ["true", "POST", "/v1/turnstile/verify", "a caller with no credential", 403, SHOWCASE_DENIED, []],
  ["true", "GET", "/catalog/public/popular", "a caller with no credential", 403, SHOWCASE_DENIED, []],
  ["true", "GET", "/catalog/public/popular?spoof=1", "a caller with no credential", 403, SHOWCASE_DENIED, []],
  ["true", "POST", "/v1/unknown", "a verified caller", 403, SHOWCASE_DENIED, []],
  ["true", "GET", "/v1/chat", "a verified caller", 403, SHOWCASE_DENIED, []],
  ["true", "POST", "/v1/session/migrate", "a verified caller", 403, SHOWCASE_DENIED, []],
  ["true", "GET", "/unknown", "a verified caller", 404, NOT_FOUND, []],
  ["true", "GET", "/", "a caller with no credential", 404, NOT_FOUND, []],
  ["true", "POST", "/catalog/public/popular", "a caller with no credential", 404, NOT_FOUND, []],
  ["true", "HEAD", "/healthz", "a caller with no credential", 404, "", []],
  ["true", "GET", "/healthz", "a caller with no credential", 200, '{"status":"ok"}', []],
  ["true", "GET", "/tiles/styles/basemap.json", "a caller with no credential", 200, '{"version":8}', ["tiles tiles/styles/basemap.json"]],
  ["true", "POST", "/tiles/styles/basemap.json", "a caller with no credential", 405, TILE_METHOD_NOT_ALLOWED, []],
  ["true", "GET", "/img/docs/archive/a.png", "a caller with no credential", 200, "png-bytes", ["docs archive/a.png"]],
  ["true", "GET", "/img/a.jpg?plan=h160", "a caller with no credential", 200, "jpeg-bytes", ["origin https://image.anitabi.cn/a.jpg?plan=h160"]],
  ["TRUE", "GET", "/v1/conversations", "a verified caller", 403, SHOWCASE_DENIED, []],
  ["False", "GET", "/v1/conversations", "a verified caller", 403, SHOWCASE_DENIED, []],
  ["false ", "GET", "/v1/conversations", "a verified caller", 403, SHOWCASE_DENIED, []],
  ["0", "GET", "/v1/conversations", "a verified caller", 403, SHOWCASE_DENIED, []],
  ["", "GET", "/v1/conversations", "a verified caller", 403, SHOWCASE_DENIED, []],
];

for (const [showcase, method, path, caller, status, body, log] of GATED) {
  void test(`with EDGE_SHOWCASE_MODE=${JSON.stringify(showcase)}, ${method} ${path} from ${caller} answers ${String(status)}`, async (t) => {
    const seam = entrySeam(t, LIMITED, { EDGE_SHOWCASE_MODE: showcase });
    const response = await seam.send(method, path, CALLERS[caller]);
    assert.equal(response.status, status);
    assert.equal(await response.text(), body);
    assert.deepEqual(seam.log, log);
  });
}
