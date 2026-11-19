import pg from "pg";
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import { ANITABI_THUMBNAIL_PLAN } from "@animichi/contract/anitabi-display";
import { serveImage, type ImgDeps } from "../src/media/img";
import { DEFAULT_ATTEMPT_TIMEOUT_MS } from "../src/ingest/retry";
import { acquireCatalogRuntime, catalogPrisma, type CatalogPrisma, type CatalogRuntime } from "../src/db/prisma";
import { databaseDescribe, planeDatabaseUrl, truncateCatalogPool } from "./integration-db";
import { abortTimeoutsOnFakeClock } from "./fakes/abort-timeout";
import { workSeed } from "./fixtures/catalog-seed";
import { mediaAssetOf, seedImagePoint, seedMediaWork } from "./fixtures/media-seed";
import {
  makeFailingImageFetch, makeImageBucketStub, makeStalledBodyImageFetch, makeUnansweredImageFetch,
} from "./media-doubles";

/**
 * How long a point photo's origin pull may run, and what ends it (`src/media/img.ts`).
 *
 * The pull runs under the request's signal and a timeout, whichever ends first.
 * A pull that times out, waiting for the headers or reading the body, or that
 * fails in transport answers 502 "Upstream error" with nothing cached, stored or
 * tombstoned. A pull the request cancelled rethrows the request's own reason.
 *
 * Every pull is stubbed through `deps.fetchImpl`, so nothing here leaves the
 * machine; each one is on the image.anitabi.cn URL a real pull of that row would
 * fetch, and each test states it.
 */

let pool: pg.Pool;
let runtime: CatalogRuntime;
let query: CatalogPrisma;

const BOUNDS_WORK = workSeed("3701", "らき☆すた");

beforeAll(async () => {
  pool = new pg.Pool({ connectionString: planeDatabaseUrl(), connectionTimeoutMillis: 10_000 });
  await truncateCatalogPool(pool);
  await seedMediaWork(pool, BOUNDS_WORK);
  runtime = await acquireCatalogRuntime(planeDatabaseUrl());
  query = catalogPrisma(runtime);
}, 120_000);

afterAll(async () => {
  await runtime[Symbol.asyncDispose]();
  await pool.end();
});

databaseDescribe("serveImage origin pull bounds", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("answers 502 when the origin never answers by the pull timeout, storing and tombstoning nothing", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    abortTimeoutsOnFakeClock();
    await seedImagePoint(pool, BOUNDS_WORK, "hung-1", "https://image.anitabi.cn/hung-1.png");
    const { bucket, store } = makeImageBucketStub();
    const origin = makeUnansweredImageFetch();
    const served = serveImage({ query, bucket, fetchImpl: origin.fetchImpl }, "hung-1", ANITABI_THUMBNAIL_PLAN);
    const pull = await origin.reached;
    await vi.advanceTimersByTimeAsync(DEFAULT_ATTEMPT_TIMEOUT_MS - 1);
    expect(pull.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(pull.aborted).toBe(true);
    await expectUpstreamError(served);
    expect(origin.urls).toEqual(["https://image.anitabi.cn/hung-1.png?plan=h160"]);
    expect(store.size).toBe(0);
    expect(await mediaAssetOf(pool, "hung-1")).toBeUndefined();
  });

  it("answers 502 when the origin's body stalls past the pull timeout, storing and tombstoning nothing", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    abortTimeoutsOnFakeClock();
    await seedImagePoint(pool, BOUNDS_WORK, "stalled-1", "https://image.anitabi.cn/stalled-1.png");
    const { bucket, store } = makeImageBucketStub();
    const origin = makeStalledBodyImageFetch();
    const served = serveImage({ query, bucket, fetchImpl: origin.fetchImpl }, "stalled-1", ANITABI_THUMBNAIL_PLAN);
    await origin.reached;
    await vi.advanceTimersByTimeAsync(DEFAULT_ATTEMPT_TIMEOUT_MS);
    await expectUpstreamError(served);
    expect(origin.urls).toEqual(["https://image.anitabi.cn/stalled-1.png?plan=h160"]);
    expect(store.size).toBe(0);
    expect(await mediaAssetOf(pool, "stalled-1")).toBeUndefined();
  });

  it("answers 502 when the origin pull fails in transport, storing and tombstoning nothing", async () => {
    await seedImagePoint(pool, BOUNDS_WORK, "unreachable-1", "https://image.anitabi.cn/unreachable-1.png");
    const { bucket, store } = makeImageBucketStub();
    const origin = makeFailingImageFetch(new TypeError("fetch failed"));
    await expectUpstreamError(serveImage({ query, bucket, fetchImpl: origin.fetchImpl }, "unreachable-1", ANITABI_THUMBNAIL_PLAN));
    expect(origin.urls).toEqual(["https://image.anitabi.cn/unreachable-1.png?plan=h160"]);
    expect(store.size).toBe(0);
    expect(await mediaAssetOf(pool, "unreachable-1")).toBeUndefined();
  });
});

/** The request's own signal ends these pulls. */
databaseDescribe("serveImage cancelled by its request", () => {
  it("aborts the origin pull in flight when the request is cancelled", async () => {
    await seedImagePoint(pool, BOUNDS_WORK, "cancelled-1", "https://image.anitabi.cn/cancelled-1.png");
    const caller = new AbortController();
    const reason = new Error("the client left");
    const origin = makeUnansweredImageFetch();
    const deps: ImgDeps = { query, bucket: makeImageBucketStub().bucket, fetchImpl: origin.fetchImpl, signal: caller.signal };
    const served = serveImage(deps, "cancelled-1", ANITABI_THUMBNAIL_PLAN);
    const pull = await origin.reached;
    caller.abort(reason);
    expect(pull.reason).toBe(reason);
    await expect(served).rejects.toBe(reason);
    expect(origin.urls).toEqual(["https://image.anitabi.cn/cancelled-1.png?plan=h160"]);
  });

  it("rethrows a cancel whose reason is a TimeoutError as the caller's own, never as a 502", async () => {
    await seedImagePoint(pool, BOUNDS_WORK, "cancelled-2", "https://image.anitabi.cn/cancelled-2.png");
    const caller = new AbortController();
    const reason = new DOMException("the caller's own deadline passed", "TimeoutError");
    const origin = makeUnansweredImageFetch();
    const deps: ImgDeps = { query, bucket: makeImageBucketStub().bucket, fetchImpl: origin.fetchImpl, signal: caller.signal };
    const served = serveImage(deps, "cancelled-2", ANITABI_THUMBNAIL_PLAN);
    await origin.reached;
    caller.abort(reason);
    await expect(served).rejects.toBe(reason);
    expect(origin.urls).toEqual(["https://image.anitabi.cn/cancelled-2.png?plan=h160"]);
  });
});

/** A failed origin pull answers as a bad origin status does: 502 "Upstream error", with nothing to cache. */
async function expectUpstreamError(served: Promise<Response>): Promise<void> {
  const res = await served;
  expect(res.status).toBe(502);
  expect(await res.text()).toBe("Upstream error");
  expect(res.headers.get("Cache-Control")).toBeNull();
}
