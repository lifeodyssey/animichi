import pg from "pg";
import { afterAll, beforeAll, expect, it } from "vitest";
import { ANITABI_THUMBNAIL_PLAN, ANITABI_USER_AGENT } from "@animichi/contract/anitabi-display";
import { serveImage, type ImgDeps } from "../src/media/img";
import { acquireCatalogRuntime, catalogPrisma, type CatalogPrisma, type CatalogRuntime } from "../src/db/prisma";
import { databaseDescribe, planeDatabaseUrl, truncateCatalogPool } from "./integration-db";
import { pointInsert, pointSeed, workInsert, workSeed } from "./fixtures/catalog-seed";
import { makeCountingImageFetch, makeImageBucketStub } from "./media-doubles";

/**
 * Integration suite for the lazy-R2 media path (Wave 6): serveImage over `media_assets`.
 *
 * Runs on the Prisma-plane database the committed chain built (#1633), driving
 * the real `serveImage` through one request's `CatalogPrisma` seam with an
 * in-memory mock R2Bucket and a call-counting stub fetch. Proves the one-shot
 * pull: first request fetches the origin once + stores it in R2 + writes the
 * media_assets row; the second serves from R2 without re-fetching; an origin-404
 * tombstones and serves the fallback on this and every later request without
 * re-fetching.
 *
 * Seeding and asserting go through the pool rather than the seam under test, so
 * a plan that wrote the wrong row cannot also be the thing that reads it back.
 */

let pool: pg.Pool;
let runtime: CatalogRuntime;
let query: CatalogPrisma;

const MEDIA_WORK = workSeed("3701", "らき☆すた");

/** Seed one point carrying an origin image URL, on its own work. */
async function seedPoint(id: string, image: string | null): Promise<void> {
  const point = pointInsert([pointSeed(id, MEDIA_WORK, "spot", 36.1, 139.6)]);
  await pool.query(point.text, point.values);
  await pool.query("UPDATE points SET image = $1 WHERE id = $2", [image, id]);
}

async function assetOf(pointId: string): Promise<{ r2_key: string | null; tombstoned: boolean } | undefined> {
  const { rows } = await pool.query(
    "SELECT r2_key, tombstoned FROM media_assets WHERE point_id = $1", [pointId],
  );
  return (rows as { r2_key: string | null; tombstoned: boolean }[])[0];
}

beforeAll(async () => {
  pool = new pg.Pool({ connectionString: planeDatabaseUrl(), connectionTimeoutMillis: 10_000 });
  await truncateCatalogPool(pool);
  const work = workInsert([MEDIA_WORK]);
  await pool.query(work.text, work.values);
  runtime = await acquireCatalogRuntime(planeDatabaseUrl());
  query = catalogPrisma(runtime);
}, 120_000);

afterAll(async () => {
  await runtime[Symbol.asyncDispose]();
  await pool.end();
});

databaseDescribe("serveImage lazy-R2 one-shot pull", () => {
  it("first request fetches origin once, stores in R2, writes media_assets, serves bytes", async () => {
    await seedPoint("ok-1", "https://image.anitabi.cn/ok-1.png");
    const { bucket, store } = makeImageBucketStub();
    const { fetchImpl, calls, urls, agents } = makeCountingImageFetch(200, new Uint8Array([1, 2, 3]));
    const deps: ImgDeps = { query, bucket, fetchImpl };
    const res = await serveImage(deps, "ok-1", ANITABI_THUMBNAIL_PLAN);
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toContain("public");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
    expect(calls()).toBe(1);
    expect(urls[0]).toBe("https://image.anitabi.cn/ok-1.png?plan=h160");
    expect(agents[0]).toBe(ANITABI_USER_AGENT);
    expect(store.has("points/ok-1")).toBe(true);
    expect((await assetOf("ok-1"))?.r2_key).toBe("points/ok-1");
  });

  it("second request serves from R2 without re-fetching the origin", async () => {
    await seedPoint("ok-2", "https://image.anitabi.cn/ok-2.png");
    const { bucket } = makeImageBucketStub();
    const { fetchImpl, calls } = makeCountingImageFetch(200, new Uint8Array([9, 9]));
    const deps: ImgDeps = { query, bucket, fetchImpl };
    await serveImage(deps, "ok-2", ANITABI_THUMBNAIL_PLAN);
    const res = await serveImage(deps, "ok-2", ANITABI_THUMBNAIL_PLAN);
    expect(res.status).toBe(200);
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([9, 9]));
    expect(calls()).toBe(1);
  });
});

databaseDescribe("serveImage tombstone path", () => {
  it("origin 404 tombstones the asset and serves the fallback", async () => {
    await seedPoint("gone-1", "https://image.anitabi.cn/gone-1.png");
    const { bucket, store } = makeImageBucketStub();
    const { fetchImpl, calls } = makeCountingImageFetch(404, new Uint8Array());
    const res = await serveImage({ query, bucket, fetchImpl }, "gone-1", ANITABI_THUMBNAIL_PLAN);
    expect(res.status).toBe(404);
    expect(calls()).toBe(1);
    expect(store.size).toBe(0);
    expect((await assetOf("gone-1"))?.tombstoned).toBe(true);
  });

  it("a tombstoned asset serves the fallback on later requests without re-fetching", async () => {
    await seedPoint("gone-2", "https://image.anitabi.cn/gone-2.png");
    const { bucket } = makeImageBucketStub();
    const { fetchImpl, calls } = makeCountingImageFetch(404, new Uint8Array());
    await serveImage({ query, bucket, fetchImpl }, "gone-2", ANITABI_THUMBNAIL_PLAN);
    const res = await serveImage({ query, bucket, fetchImpl }, "gone-2", ANITABI_THUMBNAIL_PLAN);
    expect(res.status).toBe(404);
    expect(calls()).toBe(1);
  });
});
