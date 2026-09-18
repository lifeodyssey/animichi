/**
 * What the docs-asset arm of the edge image proxy serves (#1650 AC1): the
 * allowlisted read, its response surface, its method gate, and what it answers
 * when the private bucket is missing, detached or failing.
 *
 * `docs/DOCS_POLICY.md` selects private R2 objects served through edge `/img`
 * as the archive-image form; this arm is what makes that form real. The paths
 * the namespace refuses, and the `/img` boundary that decides them, are pinned
 * in `docs-assets-refusals.test.ts`; the policy contract is in
 * `docs-assets-policy.test.ts`.
 *
 * test-type: unit (no network, no clock, no bindings).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { docsAssetBinding, withRecordingOrigin, withoutImageOrigin } from "./doubles/docs-asset-doubles.ts";
import { noHitCache, storingCache, withCacheDouble } from "./doubles/cache-api-double.ts";
import { edgeAppRequest } from "./doubles/edge-app-request.ts";
import { IMAGE_CACHE_CONTROL } from "../src/proxy/image-cache-control.ts";

const ASSET_URL = "/img/docs/archive/mockups-demo/map-bench-v2.png";
const ASSET_KEY = "archive/mockups-demo/map-bench-v2.png";

/** The documented raster types, and the content type each one answers with. */
const DOCUMENTED_TYPES = [
  { extension: "png", contentType: "image/png" },
  { extension: "jpg", contentType: "image/jpeg" },
  { extension: "jpeg", contentType: "image/jpeg" },
  { extension: "webp", contentType: "image/webp" },
  { extension: "gif", contentType: "image/gif" },
] as const;

void test("an allowlisted docs asset is read from its object key and served", async (t) => {
  const reads: string[] = [];
  const response = await withoutImageOrigin(t, () => edgeAppRequest(ASSET_URL, docsAssetBinding(reads)));
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "asset-bytes");
  assert.deepEqual(reads, [ASSET_KEY]);
});

void test("a served asset advertises the preflight and the range headers a reader needs", async (t) => {
  const reads: string[] = [];
  const response = await withoutImageOrigin(t, () =>
    edgeAppRequest(ASSET_URL, docsAssetBinding(reads), { headers: { Origin: "https://animichi.com" } }));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Access-Control-Allow-Methods"), "GET, HEAD, OPTIONS");
  assert.equal(response.headers.get("Vary"), "Origin");
  assert.equal(response.headers.get("Access-Control-Expose-Headers"), "Accept-Ranges, Content-Length, Content-Range, ETag");
});

void test("a caller that named no origin is not told which headers it could read", async (t) => {
  const reads: string[] = [];
  const response = await withoutImageOrigin(t, () => edgeAppRequest(ASSET_URL, docsAssetBinding(reads)));
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), "*");
  assert.equal(response.headers.get("Access-Control-Expose-Headers"), null);
});

for (const { extension, contentType } of DOCUMENTED_TYPES) {
  void test(`the allowlist serves the documented .${extension} asset type`, async (t) => {
    const reads: string[] = [];
    const response = await withoutImageOrigin(t, () =>
      edgeAppRequest(`/img/docs/archive/mockups-demo/figure.${extension}`, docsAssetBinding(reads)));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Content-Type"), contentType);
  });
}

void test("POST is refused in the arm's method envelope without reading the bucket", async () => {
  const reads: string[] = [];
  const response = await edgeAppRequest(ASSET_URL, docsAssetBinding(reads), { method: "POST" });
  assert.equal(response.status, 405);
  assert.deepEqual(await response.json(), { error: { code: "image_method_not_allowed" } });
  assert.deepEqual(reads, []);
});

void test("OPTIONS answers the preflight with the arm's headers and reads nothing", async () => {
  const reads: string[] = [];
  const response = await edgeAppRequest(ASSET_URL, docsAssetBinding(reads), { method: "OPTIONS" });
  assert.equal(response.status, 204);
  assert.equal(response.headers.get("Access-Control-Allow-Methods"), "GET, HEAD, OPTIONS");
  assert.equal(response.headers.get("Cache-Control"), IMAGE_CACHE_CONTROL);
  assert.deepEqual(reads, []);
});

void test("HEAD reads the object and answers its metadata with no body", async (t) => {
  const reads: string[] = [];
  const response = await withoutImageOrigin(t, () => edgeAppRequest(ASSET_URL, docsAssetBinding(reads), { method: "HEAD" }));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Content-Length"), String("asset-bytes".length));
  assert.equal(await response.text(), "");
  assert.deepEqual(reads, [ASSET_KEY]);
});

void test("a docs request with no bucket binding fails closed", async (t) => {
  const response = await withoutImageOrigin(t, () => edgeAppRequest(ASSET_URL, {}));
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(await response.json(), { error: { code: "image_storage_unavailable" } });
});

void test("a detached binding fails closed even when the edge cache holds the asset", async (t) => {
  const reads: string[] = [];
  const cache = storingCache();
  const warm = await withCacheDouble(cache, () =>
    withoutImageOrigin(t, () => edgeAppRequest(ASSET_URL, docsAssetBinding(reads))));
  const detached = await withCacheDouble(cache, () => withoutImageOrigin(t, () => edgeAppRequest(ASSET_URL, {})));
  assert.equal(warm.status, 200);
  assert.equal(detached.status, 503, "the binding is gone, so the entry it left warm must not answer");
});

void test("a bucket read that fails is a retryable 503, not an origin fallback", async (t) => {
  const env = { DOCS_ASSETS: { get: () => Promise.reject(new Error("r2 unavailable")) } };
  const response = await withoutImageOrigin(t, () => edgeAppRequest(ASSET_URL, env));
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: { code: "image_storage_unavailable" } });
});

void test("a path outside the reserved namespace still proxies to the image origin", async (t) => {
  const requested: string[] = [];
  const response = await withCacheDouble(noHitCache(() => Promise.resolve()), () =>
    withRecordingOrigin(t, requested, () => edgeAppRequest("/img/image/1234/point-1.jpg?plan=h160", {})));
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "jpeg-bytes");
  assert.deepEqual(requested, ["https://image.anitabi.cn/image/1234/point-1.jpg?plan=h160"]);
});
