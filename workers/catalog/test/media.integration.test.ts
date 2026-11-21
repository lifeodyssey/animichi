import pg from "pg";
import { afterAll, beforeAll, expect, it } from "vitest";
import { ANITABI_THUMBNAIL_PLAN, ANITABI_USER_AGENT } from "@animichi/contract/anitabi-display";
import { serveImage, type ImgDeps } from "../src/media/img";
import { acquireCatalogRuntime, catalogPrisma, type CatalogPrisma, type CatalogRuntime } from "../src/db/prisma";
import { databaseDescribe, planeDatabaseUrl, truncateCatalogPool } from "./integration-db";
import { workSeed } from "./fixtures/catalog-seed";
import { mediaAssetOf, seedImagePoint, seedMediaWork } from "./fixtures/media-seed";
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
 * re-fetching. Every test states the one URL its pull fetched.
 *
 * How long a pull may run and what ends it is `media-pull-bounds.integration.test.ts`;
 * which origin it is pulled from is `media-origin.integration.test.ts`.
 */

let pool: pg.Pool;
let runtime: CatalogRuntime;
let query: CatalogPrisma;

const MEDIA_WORK = workSeed("3701", "らき☆すた");

beforeAll(async () => {
  pool = new pg.Pool({ connectionString: planeDatabaseUrl(), connectionTimeoutMillis: 10_000 });
  await truncateCatalogPool(pool);
  await seedMediaWork(pool, MEDIA_WORK);
  runtime = await acquireCatalogRuntime(planeDatabaseUrl());
  query = catalogPrisma(runtime);
}, 120_000);

afterAll(async () => {
  await runtime[Symbol.asyncDispose]();
  await pool.end();
});

databaseDescribe("serveImage lazy-R2 one-shot pull", () => {
  it("first request fetches origin once, stores in R2, writes media_assets, serves bytes", async () => {
    await seedImagePoint(pool, MEDIA_WORK, "ok-1", "https://image.anitabi.cn/ok-1.png");
    const { bucket, store } = makeImageBucketStub();
    const { fetchImpl, calls, urls, agents } = makeCountingImageFetch(200, new Uint8Array([1, 2, 3]));
    const deps: ImgDeps = { query, bucket, fetchImpl };
    const res = await serveImage(deps, "ok-1", ANITABI_THUMBNAIL_PLAN);
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toContain("public");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
    expect(calls()).toBe(1);
    expect(urls).toEqual(["https://image.anitabi.cn/ok-1.png?plan=h160"]);
    expect(agents[0]).toBe(ANITABI_USER_AGENT);
    expect(store.has("points/ok-1")).toBe(true);
    expect((await mediaAssetOf(pool, "ok-1"))?.r2_key).toBe("points/ok-1");
  });

  it("second request serves from R2 without re-fetching the origin", async () => {
    await seedImagePoint(pool, MEDIA_WORK, "ok-2", "https://image.anitabi.cn/ok-2.png");
    const { bucket } = makeImageBucketStub();
    const { fetchImpl, calls, urls } = makeCountingImageFetch(200, new Uint8Array([9, 9]));
    const deps: ImgDeps = { query, bucket, fetchImpl };
    await serveImage(deps, "ok-2", ANITABI_THUMBNAIL_PLAN);
    const res = await serveImage(deps, "ok-2", ANITABI_THUMBNAIL_PLAN);
    expect(res.status).toBe(200);
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([9, 9]));
    expect(calls()).toBe(1);
    expect(urls).toEqual(["https://image.anitabi.cn/ok-2.png?plan=h160"]);
  });
});

databaseDescribe("serveImage tombstone path", () => {
  it("origin 404 tombstones the asset and serves the fallback", async () => {
    await seedImagePoint(pool, MEDIA_WORK, "gone-1", "https://image.anitabi.cn/gone-1.png");
    const { bucket, store } = makeImageBucketStub();
    const { fetchImpl, calls, urls } = makeCountingImageFetch(404, new Uint8Array());
    const res = await serveImage({ query, bucket, fetchImpl }, "gone-1", ANITABI_THUMBNAIL_PLAN);
    expect(res.status).toBe(404);
    expect(calls()).toBe(1);
    expect(urls).toEqual(["https://image.anitabi.cn/gone-1.png?plan=h160"]);
    expect(store.size).toBe(0);
    expect((await mediaAssetOf(pool, "gone-1"))?.tombstoned).toBe(true);
  });

  it("a tombstoned asset serves the fallback on later requests without re-fetching", async () => {
    await seedImagePoint(pool, MEDIA_WORK, "gone-2", "https://image.anitabi.cn/gone-2.png");
    const { bucket } = makeImageBucketStub();
    const { fetchImpl, calls, urls } = makeCountingImageFetch(404, new Uint8Array());
    await serveImage({ query, bucket, fetchImpl }, "gone-2", ANITABI_THUMBNAIL_PLAN);
    const res = await serveImage({ query, bucket, fetchImpl }, "gone-2", ANITABI_THUMBNAIL_PLAN);
    expect(res.status).toBe(404);
    expect(calls()).toBe(1);
    expect(urls).toEqual(["https://image.anitabi.cn/gone-2.png?plan=h160"]);
  });
});
