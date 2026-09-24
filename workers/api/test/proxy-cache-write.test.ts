/**
 * EG-16 (#1343): a cache write that fails says so.
 *
 * The image proxy left `ctx.waitUntil(cache.put(...))` unhandled and the tile
 * proxy swallowed the same rejection with `.catch(() => undefined)` — the exact
 * pair the catalog worker was already caught with (08-26 §2.4). A cache tier
 * that is silently failing looks like a slow origin, so every proxy writes
 * through one `cacheWrite` that records the failure.
 *
 * The cache global and the context whose promises a case can await are shared
 * doubles (`doubles/cache-api-double.ts`, `collectingCtx`) — the same seam the
 * docs-asset cases use.
 *
 * test-type: unit
 */
import test from "node:test";
import assert from "node:assert/strict";
import { collectingCtx } from "./doubles/entry-env.ts";
import { cacheWrite } from "../src/proxy/cache-write.ts";
import { withImageOrigin } from "./doubles/docs-asset-doubles.ts";
import { noHitCache, withCacheDouble, type CachePut } from "./doubles/cache-api-double.ts";
import { edgeAppRequest } from "./doubles/edge-app-request.ts";

async function withWarnSpy(run: () => Promise<unknown>): Promise<string[]> {
  const lines: string[] = [];
  const original = console.warn;
  console.warn = (line: unknown) => { lines.push(String(line)); };
  try {
    await run();
    return lines;
  } finally { console.warn = original; }
}

const rejectingPut: CachePut = () => Promise.reject(new RangeError("cache api down"));

void test("a rejected cache write is recorded under the caller's own event name", async () => {
  const settled: Promise<unknown>[] = [];
  const lines = await withWarnSpy(async () => {
    cacheWrite(collectingCtx(settled), Promise.reject(new RangeError("cache api down")), "test_cache_write_failed");
    await Promise.all(settled);
  });
  assert.deepEqual(lines.map((line) => JSON.parse(line) as unknown), [
    { event: "test_cache_write_failed", error: "RangeError" },
  ]);
});

void test("a cache write that succeeds stays silent", async () => {
  const settled: Promise<unknown>[] = [];
  const lines = await withWarnSpy(async () => {
    cacheWrite(collectingCtx(settled), Promise.resolve(), "test_cache_write_failed");
    await Promise.all(settled);
  });
  assert.deepEqual(lines, []);
});

void test("a tile whose cache write fails is still served, and the failure is logged", async () => {
  const settled: Promise<unknown>[] = [];
  const env = {
    MAP_TILES: { get: () => Promise.resolve({ body: new Response("mvt").body, etag: "t", size: 3 }) },
  };
  const lines = await withWarnSpy(async () => {
    const response = await withCacheDouble(noHitCache(rejectingPut), () =>
      edgeAppRequest("/tiles/14/135/892.mvt", env, {}, collectingCtx(settled)));
    assert.equal(response.status, 200);
    await Promise.all(settled);
  });
  assert.equal(lines.includes('{"event":"edge_tile_cache_write_failed","error":"RangeError"}'), true);
});

void test("an image whose cache write fails is still served, and the failure is logged", async (t) => {
  const settled: Promise<unknown>[] = [];
  const upstreamFetch = () => Promise.resolve(new Response("jpeg-bytes", { status: 200 }));
  const lines = await withWarnSpy(async () => {
    const response = await withCacheDouble(noHitCache(rejectingPut), () =>
      withImageOrigin(t, upstreamFetch, () => edgeAppRequest("/img/p1.jpg?plan=h160", {}, {}, collectingCtx(settled))));
    assert.equal(response.status, 200);
    await Promise.all(settled);
  });
  assert.equal(lines.includes('{"event":"edge_image_cache_write_failed","error":"RangeError"}'), true);
});
