import { afterAll, beforeAll, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import type { CatalogDb } from "../src/db/client";
import { serveImage, type ImageFetchLike, type ImgDeps } from "../src/media/img";
import {
  databaseDescribe,
  openServerlessDb,
  restoreNeonConfig,
  truncateCatalog,
} from "./spike-db";

/**
 * Spike for the lazy-R2 media path (Wave 6): serveImage over `media_assets`.
 *
 * Uses the suite branch's full Atlas schema, then drives serveImage through Neon
 * Local HTTP with an in-memory mock R2Bucket and a
 * call-counting stub fetch. Proves the one-shot pull: first request fetches the
 * origin once + stores it in R2 + writes the media_assets row; the second serves
 * from R2 without re-fetching; an origin-404 tombstones and serves the fallback
 * on this and every later request without re-fetching.
 */

let db: CatalogDb;

async function seedPoint(id: string, image: string | null): Promise<void> {
  await db.execute(
    sql`INSERT INTO points (id, name, latitude, longitude, image)
        VALUES (${id}, ${"spot"}, ${36.1}, ${139.6}, ${image})`,
  );
}

async function assetOf(pointId: string): Promise<{ r2_key: string | null; tombstoned: boolean } | undefined> {
  const rows = (
    await db.execute(
      sql`SELECT r2_key, tombstoned FROM media_assets WHERE point_id = ${pointId}`,
    )
  ).rows as { r2_key: string | null; tombstoned: boolean }[];
  return rows[0];
}

// In-memory R2Bucket stub: only the get/put surface serveImage exercises.
function mockBucket(): { bucket: R2Bucket; store: Map<string, { body: ArrayBuffer; contentType: string }> } {
  const store = new Map<string, { body: ArrayBuffer; contentType: string }>();
  const bucket = {
    put(key: string, body: ArrayBuffer, opts?: { httpMetadata?: { contentType?: string } }) {
      store.set(key, { body, contentType: opts?.httpMetadata?.contentType ?? "image/jpeg" });
      return Promise.resolve(undefined as unknown as R2Object);
    },
    get(key: string) {
      const hit = store.get(key);
      if (!hit) return Promise.resolve(null);
      return Promise.resolve({
        httpMetadata: { contentType: hit.contentType },
        arrayBuffer: () => Promise.resolve(hit.body),
      });
    },
  };
  return { bucket: bucket as unknown as R2Bucket, store };
}

// Call-counting fetch stub returning bytes (status 200) or a status (404/etc).
function mockFetch(status: number, bytes: Uint8Array): { fetchImpl: ImageFetchLike; calls: () => number } {
  let count = 0;
  const fetchImpl: ImageFetchLike = () => {
    count += 1;
    return Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      headers: { get: (n: string) => (n.toLowerCase() === "content-type" ? "image/png" : null) },
      arrayBuffer: () => Promise.resolve(bytes.buffer.slice(0) as ArrayBuffer),
    });
  };
  return { fetchImpl, calls: () => count };
}

beforeAll(async () => {
  db = await openServerlessDb();
  await truncateCatalog(db);
}, 120_000);

afterAll(() => { restoreNeonConfig(); });

databaseDescribe("serveImage lazy-R2 one-shot pull", () => {
  it("first request fetches origin once, stores in R2, writes media_assets, serves bytes", async () => {
    await seedPoint("ok-1", "https://image.anitabi.cn/ok-1.png");
    const { bucket, store } = mockBucket();
    const { fetchImpl, calls } = mockFetch(200, new Uint8Array([1, 2, 3]));
    const deps: ImgDeps = { db, bucket, fetchImpl };
    const res = await serveImage(deps, "ok-1");
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toContain("public");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
    expect(calls()).toBe(1);
    expect(store.has("points/ok-1")).toBe(true);
    expect((await assetOf("ok-1"))?.r2_key).toBe("points/ok-1");
  });

  it("second request serves from R2 without re-fetching the origin", async () => {
    await seedPoint("ok-2", "https://image.anitabi.cn/ok-2.png");
    const { bucket } = mockBucket();
    const { fetchImpl, calls } = mockFetch(200, new Uint8Array([9, 9]));
    const deps: ImgDeps = { db, bucket, fetchImpl };
    await serveImage(deps, "ok-2");
    const res = await serveImage(deps, "ok-2");
    expect(res.status).toBe(200);
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([9, 9]));
    expect(calls()).toBe(1);
  });
});

databaseDescribe("serveImage tombstone path", () => {
  it("origin 404 tombstones the asset and serves the fallback", async () => {
    await seedPoint("gone-1", "https://image.anitabi.cn/gone-1.png");
    const { bucket, store } = mockBucket();
    const { fetchImpl, calls } = mockFetch(404, new Uint8Array());
    const res = await serveImage({ db, bucket, fetchImpl }, "gone-1");
    expect(res.status).toBe(404);
    expect(calls()).toBe(1);
    expect(store.size).toBe(0);
    expect((await assetOf("gone-1"))?.tombstoned).toBe(true);
  });

  it("a tombstoned asset serves the fallback on later requests without re-fetching", async () => {
    await seedPoint("gone-2", "https://image.anitabi.cn/gone-2.png");
    const { bucket } = mockBucket();
    const { fetchImpl, calls } = mockFetch(404, new Uint8Array());
    await serveImage({ db, bucket, fetchImpl }, "gone-2");
    const res = await serveImage({ db, bucket, fetchImpl }, "gone-2");
    expect(res.status).toBe(404);
    expect(calls()).toBe(1);
  });
});
