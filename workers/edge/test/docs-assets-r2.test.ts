/**
 * Range, content type, cache metadata and missing-object behaviour for the
 * R2-backed docs-asset arm (#1650 AC2), proved against a real R2 bucket:
 * Miniflare's workerd implementation, reached through the same `get` port the
 * deployed binding satisfies. No network, no Docker, no cloud credentials.
 *
 * The edge Cache API is a node-side global that is absent under `node --test`
 * (which is why the private-R2 shell guards it), so the cache-tier case installs
 * its own double: Miniflare's Cache API is not reachable from node (its RPC
 * layer cannot serialize a node `Request`/`Response`). That one case says so at
 * the point of use; everything else here — every cache-*metadata*, range and
 * content-type answer — is a real R2 object's.
 *
 * Each case seeds the key it reads, so no case can disturb another's object.
 *
 * test-type: integration (a real R2 implementation through the edge request path).
 */
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { Miniflare } from "miniflare";
import { collectingCtx } from "../src/container/entry-env.ts";
import { storingCache, withCacheDouble } from "./doubles/cache-api-double.ts";
import { edgeAppRequest } from "./doubles/edge-app-request.ts";
import { IMAGE_CACHE_CONTROL } from "../src/proxy/image-cache-control.ts";
import type { R2ObjectBucket } from "../src/proxy/private-r2-object.ts";

const BYTES = "0123456789abcdefghij";
const encoder = new TextEncoder();
const mf = new Miniflare({
  modules: true,
  script: "export default { async fetch() { return new Response('ok'); } }",
  r2Buckets: ["DOCS_ASSETS"],
});
const bucket = await mf.getR2Bucket("DOCS_ASSETS");
after(() => mf.dispose());

// Miniflare types its objects against the workerd globals (their `ReadableStream`
// and range union), not this package's narrow `get` port; the object behind it is
// the deployed binding's own.
const env = { DOCS_ASSETS: bucket as R2ObjectBucket };

/** Seeds one object and returns the URL that serves it. */
async function storedAsset(key: string, bytes: string, contentType: string): Promise<string> {
  await bucket.put(key, encoder.encode(bytes), { httpMetadata: { contentType } });
  return `/img/docs/${key}`;
}

void test("a stored asset is served with the image cache policy and the object's own ETag", async () => {
  const key = "archive/mockups-demo/map-bench-v2.png";
  const url = await storedAsset(key, BYTES, "image/png");
  const object = await bucket.get(key);
  const response = await edgeAppRequest(url, env);
  assert.equal(response.status, 200);
  assert.equal(await response.text(), BYTES);
  assert.equal(response.headers.get("Content-Type"), "image/png");
  assert.equal(response.headers.get("Cache-Control"), IMAGE_CACHE_CONTROL);
  assert.equal(response.headers.get("Accept-Ranges"), "bytes");
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), "*");
  assert.equal(response.headers.get("Content-Length"), String(BYTES.length));
  assert.equal(response.headers.get("ETag"), object?.httpEtag);
});

void test("the object's stored content type wins over the extension default", async () => {
  const url = await storedAsset("archive/landing-hero/hero.jpg", "jpeg-bytes", "image/avif");
  const response = await edgeAppRequest(url, env);
  assert.equal(response.headers.get("Content-Type"), "image/avif");
});

void test("a Range request answers the requested slice as 206 and is not cacheable", async () => {
  const url = await storedAsset("archive/range/slice.png", BYTES, "image/png");
  const response = await edgeAppRequest(url, env, { headers: { Range: "bytes=2-5" } });
  assert.equal(response.status, 206);
  assert.equal(response.headers.get("Content-Range"), `bytes 2-5/${String(BYTES.length)}`);
  assert.equal(response.headers.get("Content-Length"), "4");
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal(await response.text(), BYTES.slice(2, 6));
});

void test("a suffix Range request answers the tail as 206", async () => {
  const url = await storedAsset("archive/range/tail.png", BYTES, "image/png");
  const response = await edgeAppRequest(url, env, { headers: { Range: "bytes=-4" } });
  assert.equal(response.status, 206);
  assert.equal(response.headers.get("Content-Range"), `bytes 16-19/${String(BYTES.length)}`);
  assert.equal(await response.text(), BYTES.slice(-4));
});

void test("a malformed Range is refused as 416 before the bucket is read", async () => {
  const url = await storedAsset("archive/range/malformed.png", BYTES, "image/png");
  const response = await edgeAppRequest(url, env, { headers: { Range: "bytes=8-2" } });
  assert.equal(response.status, 416);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(await response.json(), { error: { code: "image_range_not_satisfiable" } });
});

void test("a well-formed Range past the end of the object is the storage refusal, as on the tile arm", async () => {
  // `bytes=99-100` on a 20-byte object: R2 (Miniflare and the deployed binding
  // alike) throws rather than answering an empty slice, so the arm answers the
  // same retryable 503 a failing read gets. A 416 would need this arm to learn
  // the object's size before answering — a second read of the object, and a
  // divergence from the tile arm's contract for the same input.
  const url = await storedAsset("archive/range/unsatisfiable.png", BYTES, "image/png");
  const response = await edgeAppRequest(url, env, { headers: { Range: "bytes=99-100" } });
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: { code: "image_storage_unavailable" } });
});

void test("a missing object is a 404 in the shared envelope", async () => {
  const response = await edgeAppRequest("/img/docs/archive/mockups-demo/absent.png", env);
  assert.equal(response.status, 404);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(await response.json(), { error: { code: "image_not_found" } });
});

void test("HEAD answers the object metadata and no body", async () => {
  const url = await storedAsset("archive/head/metadata.png", BYTES, "image/png");
  const response = await edgeAppRequest(url, env, { method: "HEAD" });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Content-Length"), String(BYTES.length));
  assert.equal(await response.text(), "");
});

void test("a repeated GET is answered by the edge cache, not the bucket", async () => {
  // This case is the one that cannot use the real Cache API from node, so its
  // `caches` global is the double; the R2 half — including the object this case
  // deletes between the two requests — stays real.
  const key = "archive/mockups-demo/cache-probe.png";
  const url = await storedAsset(key, BYTES, "image/png");
  const settled: Promise<unknown>[] = [];
  const ctx = collectingCtx(settled);
  const cache = storingCache();
  const first = await withCacheDouble(cache, () => edgeAppRequest(url, env, {}, ctx));
  await Promise.all(settled);
  await bucket.delete(key);
  const second = await withCacheDouble(cache, () => edgeAppRequest(url, env, {}, ctx));
  assert.equal(first.status, 200);
  assert.equal(second.status, 200, "the object is gone from R2, so a 200 can only come from the cache");
  assert.equal(await second.text(), BYTES);
});
