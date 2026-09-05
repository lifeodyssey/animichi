/**
 * EG-16 (#1343): a cache write that fails says so.
 *
 * The image proxy left `ctx.waitUntil(cache.put(...))` unhandled and the tile
 * proxy swallowed the same rejection with `.catch(() => undefined)` — the exact
 * pair the catalog worker was already caught with (08-26 §2.4). A cache tier
 * that is silently failing looks like a slow origin, so both proxies now write
 * through one `cacheWrite` that records the failure.
 *
 * test-type: unit
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createWorkerApp } from "../src/app.ts";
import { cacheWrite } from "../src/proxy/cache-write.ts";

type CachePut = (key: Request, response: Response) => Promise<void>;

function collectingCtx(settled: Promise<unknown>[]): { waitUntil(promise: Promise<unknown>): void } {
  return { waitUntil: (promise) => { settled.push(promise); } };
}

async function withWarnSpy(run: () => Promise<unknown>): Promise<string[]> {
  const lines: string[] = [];
  const original = console.warn;
  console.warn = (line: unknown) => { lines.push(String(line)); };
  try {
    await run();
    return lines;
  } finally {
    console.warn = original;
  }
}

/** Installs a `caches.default` whose `put` behaves as the test says, for the
 * duration of one run — the global is absent under node:test otherwise. */
async function withCache(put: CachePut, run: () => Promise<Response> | Response): Promise<Response> {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "caches");
  const value = { default: { match: () => Promise.resolve(undefined), put } };
  Object.defineProperty(globalThis, "caches", { configurable: true, value });
  try {
    return await run();
  } finally {
    if (previous) Object.defineProperty(globalThis, "caches", previous);
    else Reflect.deleteProperty(globalThis, "caches");
  }
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
  } as never;
  const lines = await withWarnSpy(async () => {
    const response = await withCache(rejectingPut, () =>
      createWorkerApp({}).request("/tiles/14/135/892.mvt", {}, env, collectingCtx(settled) as never));
    assert.equal(response.status, 200);
    await Promise.all(settled);
  });
  assert.equal(lines.includes('{"event":"edge_tile_cache_write_failed","error":"RangeError"}'), true);
});

void test("an image whose cache write fails is still served, and the failure is logged", async () => {
  const settled: Promise<unknown>[] = [];
  const upstream = new Response("jpeg-bytes", { status: 200 });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => Promise.resolve(upstream);
  try {
    const lines = await withWarnSpy(async () => {
      const response = await withCache(rejectingPut, () =>
        createWorkerApp({}).request("/img/p1.jpg", {}, {}, collectingCtx(settled) as never));
      assert.equal(response.status, 200);
      await Promise.all(settled);
    });
    assert.equal(lines.includes('{"event":"edge_image_cache_write_failed","error":"RangeError"}'), true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
