/**
 * Every `/img` path the docs-asset arm refuses (#1650 AC1): the reserved
 * namespace's own rules, the encoded forms the `/img` boundary reads as a
 * separator, a backslash or a traversal, and the two-level climb the review
 * raised (F1).
 *
 * Two layers decide these, and a case can only be answered by the layer that
 * sees it: `image-proxy.ts` owns the `/img/` path grammar — the last point at
 * which the path is still ours to judge, because the runtime has already
 * resolved the dot segments of the request line — and `docs-assets.ts` owns the
 * key allowlist behind it. A refused path never reaches a source: the bucket
 * double here counts reads, and the origin rejects.
 *
 * test-type: unit (no network, no clock, no bindings).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { docsAssetBinding, withRecordingOrigin, withoutImageOrigin } from "./doubles/docs-asset-doubles.ts";
import { noHitCache, withCacheDouble } from "./doubles/cache-api-double.ts";
import { edgeAppRequest } from "./doubles/edge-app-request.ts";

const CONTROL_URL = "/img/a..b.png";

/** Paths the reserved namespace refuses: an unknown docs sub-prefix, a
 * non-image extension, no extension at all, a dot-leading segment, the
 * namespace itself with and without its slash, the arm's own pre-existing `..`
 * rule, and the encoded forms — a separator, a backslash, a one-level climb
 * resolved before the Worker, a climb out of the namespace, a second encoding
 * level, and an encoded separator or backslash outside the namespace. The empty
 * segment of a doubled slash is refused too: it would otherwise be forwarded as
 * a path the origin never published. */
const REFUSED_URLS = [
  "/img/docs/design/figure.png",
  "/img/docs/archive/notes.txt",
  "/img/docs/archive/secret",
  "/img/docs/archive/.env.png",
  "/img/docs/",
  "/img/docs",
  "/img/a..b.png",
  "/img/docs/archive/a%2fb/photo.png",
  "/img/docs/archive/a%5cb/photo.png",
  "/img/docs/archive/%2e%2e/secret.png",
  "/img/%2e%2e%2fsecret.png",
  "/img/%252e%252e/secret.png",
  "/img/a%2fb.png",
  "/img/a%5cb.png",
  "/img//photo.png",
];

for (const path of REFUSED_URLS) {
  void test(`${path} is refused in the arm's envelope without reading the bucket`, async (t) => {
    const reads: string[] = [];
    const env = docsAssetBinding(reads);
    // The control is the arm's own pre-existing traversal refusal, so this file
    // never restates the envelope it has to match.
    const control = await withoutImageOrigin(t, () => edgeAppRequest(CONTROL_URL, env));
    const response = await withoutImageOrigin(t, () => edgeAppRequest(path, env));
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), await control.json());
    assert.deepEqual(reads, []);
  });
}

void test("a two-level encoded climb is resolved before the Worker and never reaches a docs key", async (t) => {
  // The review's F1 form. WHATWG URL resolution — which workerd applies to the
  // request line itself, so the Worker only ever sees the result (raw-socket
  // probe recorded in the round-1 fix report) — turns `/img/docs/archive/` +
  // `%2e%2e/%2e%2e/` + `<asset>` into `/img/<asset>`: no docs namespace is left
  // to escape, the asset is never looked up in the docs bucket, and the path the
  // origin is asked for is one any client could have requested outright.
  const reads: string[] = [];
  const requested: string[] = [];
  const response = await withCacheDouble(noHitCache(() => Promise.resolve()), () =>
    withRecordingOrigin(t, requested, () =>
      edgeAppRequest("/img/docs/archive/%2e%2e/%2e%2e/secret.png", docsAssetBinding(reads))));
  assert.equal(response.status, 200);
  assert.deepEqual(reads, []);
  assert.deepEqual(requested, ["https://image.anitabi.cn/secret.png"]);
});
