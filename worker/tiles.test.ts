import test from "node:test";
import assert from "node:assert/strict";
import { createWorkerApp } from "./app.ts";
import type { TileBucket } from "./tiles.ts";

const ctx = {
  waitUntil: () => undefined,
  passThroughOnException: () => undefined,
  props: {},
} as unknown as ExecutionContext;

type RecordedGet = Readonly<{ key: string; options?: Readonly<{ range?: Readonly<Record<string, number>> }> }>;

const tileObject = (body = "tile", range?: Readonly<{ offset: number; length: number }>, size = body.length) => {
  const response = new Response(body);
  return {
    body: response.body,
    etag: "etag-tile",
    size,
    range,
  };
};

const envFor = (get: TileBucket["get"]): never => ({ MAP_TILES: { get } } as never);

void test("GET serves a same-origin vector asset with cache-safe headers", async () => {
  let seen: RecordedGet | undefined;
  const app = createWorkerApp({});
  const response = await app.request(
    "/tiles/14/135/892.mvt",
    {},
    envFor((key, options) => {
      seen = { key, options: options as RecordedGet["options"] };
      return Promise.resolve(tileObject("mvt-bytes"));
    }),
    ctx,
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Content-Type"), "application/vnd.mapbox-vector-tile");
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), "*");
  assert.equal(await response.text(), "mvt-bytes");
  assert.deepEqual(seen, { key: "tiles/14/135/892.mvt", options: undefined });
});

void test("a missing vector asset is an empty tile, not a storage failure", async () => {
  const app = createWorkerApp({});
  const response = await app.request(
    "/tiles/0/0/0.mvt",
    {},
    envFor(() => Promise.resolve(null)),
    ctx,
  );
  assert.equal(response.status, 204);
  assert.equal(await response.text(), "");
});

void test("a missing glyph or style asset is a hard 404", async () => {
  const app = createWorkerApp({});
  const response = await app.request(
    "/tiles/fonts/Noto%20Sans/0-255.pbf",
    {},
    envFor(() => Promise.resolve(null)),
    ctx,
  );
  assert.equal(response.status, 404);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(await response.json(), { error: "tile_not_found" });
});

void test("the asset allowlist rejects unscoped objects and invalid tile coordinates", async () => {
  let reads = 0;
  const app = createWorkerApp({});
  const get = () => {
    reads += 1;
    return Promise.resolve(tileObject());
  };
  const unscoped = await app.request("/tiles/private.json", {}, envFor(get), ctx);
  const invalid = await app.request("/tiles/23/0/0.mvt", {}, envFor(get), ctx);
  assert.equal(unscoped.status, 404);
  assert.equal(invalid.status, 404);
  assert.equal(reads, 0);
});

void test("Range requests pass through to R2 and return 206", async () => {
  let seen: RecordedGet | undefined;
  const app = createWorkerApp({});
  const response = await app.request(
    "/tiles/uji-kyoto.pmtiles",
    { headers: { Range: "bytes=8-15" } },
    envFor((key, options) => {
      seen = { key, options: options as RecordedGet["options"] };
      return Promise.resolve(tileObject("directory", { offset: 8, length: 8 }));
    }),
    ctx,
  );
  assert.equal(response.status, 206);
  assert.equal(response.headers.get("Content-Range"), "bytes 8-15/9");
  assert.deepEqual(seen, { key: "tiles/uji-kyoto.pmtiles", options: { range: { offset: 8, length: 8 } } });
});

void test("suffix Range requests use the R2 suffix form and return 206", async () => {
  let seen: RecordedGet | undefined;
  const app = createWorkerApp({});
  const response = await app.request(
    "/tiles/uji-kyoto.pmtiles",
    { headers: { Range: "bytes=-4" } },
    envFor((key, options) => {
      seen = { key, options: options as RecordedGet["options"] };
      return Promise.resolve(tileObject("tail", { offset: 6, length: 4 }, 10));
    }),
    ctx,
  );
  assert.equal(response.status, 206);
  assert.equal(response.headers.get("Content-Range"), "bytes 6-9/10");
  assert.deepEqual(seen, { key: "tiles/uji-kyoto.pmtiles", options: { range: { suffix: 4 } } });
});

void test("HEAD returns metadata without a response body", async () => {
  const app = createWorkerApp({});
  const response = await app.request(
    "/tiles/uji-kyoto.pmtiles",
    { method: "HEAD" },
    envFor(() => Promise.resolve(tileObject("archive"))),
    ctx,
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Content-Length"), "7");
  assert.equal(await response.text(), "");
});

void test("cache writes are GET-only and HEAD uses the GET cache key", async () => {
  const matches: string[] = [];
  const puts: string[] = [];
  const previous = Object.getOwnPropertyDescriptor(globalThis, "caches");
  Object.defineProperty(globalThis, "caches", {
    configurable: true,
    value: {
      default: {
        match: (request: Request) => {
          matches.push(request.method);
          return Promise.resolve(null);
        },
        put: (request: Request) => {
          puts.push(request.method);
          return Promise.resolve();
        },
      },
    },
  });
  try {
    const app = createWorkerApp({});
    const get = () => Promise.resolve(tileObject("archive"));
    const head = await app.request("/tiles/uji-kyoto.pmtiles", { method: "HEAD" }, envFor(get), ctx);
    const response = await app.request("/tiles/uji-kyoto.pmtiles", {}, envFor(get), ctx);
    assert.equal(head.status, 200);
    assert.equal(response.status, 200);
    assert.deepEqual(matches, ["GET", "GET"]);
    assert.deepEqual(puts, ["GET"]);
  } finally {
    if (previous) Object.defineProperty(globalThis, "caches", previous);
    else Reflect.deleteProperty(globalThis, "caches");
  }
});

void test("invalid paths and methods cannot read arbitrary R2 objects", async () => {
  let reads = 0;
  const app = createWorkerApp({});
  const get = () => {
    reads += 1;
    return Promise.resolve(tileObject());
  };
  const traversal = await app.request("/tiles/%2e%2e/secrets.json", {}, envFor(get), ctx);
  const method = await app.request("/tiles/uji-kyoto.pmtiles", { method: "POST" }, envFor(get), ctx);
  assert.equal(traversal.status, 404);
  assert.equal(method.status, 405);
  assert.equal(reads, 0);
});

void test("R2 failures are a retryable 503 for MapLibre fallback", async () => {
  const app = createWorkerApp({});
  const response = await app.request(
    "/tiles/uji-kyoto.pmtiles",
    {},
    envFor(() => Promise.reject(new Error("r2 unavailable"))),
    ctx,
  );
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(await response.json(), { error: "tile_storage_unavailable" });
});

void test("a missing binding fails closed instead of falling through to another origin", async () => {
  const app = createWorkerApp({});
  const response = await app.request("/tiles/uji-kyoto.pmtiles", {}, {}, ctx);
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(await response.json(), { error: "tile_storage_unavailable" });
});
