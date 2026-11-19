import pg from "pg";
import { afterAll, beforeAll, expect, it } from "vitest";
import { ANITABI_MOBILE_PLAN, ANITABI_THUMBNAIL_PLAN, type AnitabiImagePlan } from "@animichi/contract/anitabi-display";
import { serveImage } from "../src/media/img";
import { acquireCatalogRuntime, catalogPrisma, type CatalogPrisma, type CatalogRuntime } from "../src/db/prisma";
import { databaseDescribe, planeDatabaseUrl, truncateCatalogPool } from "./integration-db";
import { workSeed } from "./fixtures/catalog-seed";
import { mediaAssetOf, seedImagePoint, seedMediaWork } from "./fixtures/media-seed";
import { makeCountingImageFetch, makeImageBucketStub } from "./media-doubles";

/**
 * The origin `serveImage` pulls a point's photo from (`src/media/img.ts`,
 * `src/media/image-origin.ts`), on the Prisma-plane database.
 *
 * A stored image on the image origin — a leading-slash path, or a URL on
 * image.anitabi.cn — is pulled from the URL it has always been pulled from:
 * `https://image.anitabi.cn/<path>?<query>` with the requested size plan. A
 * redirect answer is a 502 with nothing stored.
 *
 * Every pull is stubbed through `deps.fetchImpl`; nothing here leaves the machine.
 */

let pool: pg.Pool;
let runtime: CatalogRuntime;
let query: CatalogPrisma;

const ORIGIN_WORK = workSeed("3702", "ハルヒ");

beforeAll(async () => {
  pool = new pg.Pool({ connectionString: planeDatabaseUrl(), connectionTimeoutMillis: 10_000 });
  await truncateCatalogPool(pool);
  await seedMediaWork(pool, ORIGIN_WORK);
  runtime = await acquireCatalogRuntime(planeDatabaseUrl());
  query = catalogPrisma(runtime);
}, 120_000);

afterAll(async () => {
  await runtime[Symbol.asyncDispose]();
  await pool.end();
});

/** Stored images on the image origin, each with the size plan requested and the URL that pull fetches. */
const ON_ORIGIN: readonly { id: string; stored: string; plan: AnitabiImagePlan; pulled: string }[] = [
  { id: "absolute-1", stored: "https://image.anitabi.cn/absolute-1.png", plan: ANITABI_THUMBNAIL_PLAN, pulled: "https://image.anitabi.cn/absolute-1.png?plan=h160" },
  { id: "path-1", stored: "/2024/path-1.png", plan: ANITABI_THUMBNAIL_PLAN, pulled: "https://image.anitabi.cn/2024/path-1.png?plan=h160" },
  { id: "query-1", stored: "https://image.anitabi.cn/query-1.png?v=2", plan: ANITABI_THUMBNAIL_PLAN, pulled: "https://image.anitabi.cn/query-1.png?v=2&plan=h160" },
  { id: "plan-1", stored: "https://image.anitabi.cn/plan-1.png?plan=h160", plan: ANITABI_MOBILE_PLAN, pulled: "https://image.anitabi.cn/plan-1.png?plan=h360" },
];

databaseDescribe("serveImage pulls a stored image on the image origin from its URL there", () => {
  it.each(ON_ORIGIN)("pulls $stored at $plan from exactly $pulled, and serves and stores it", async ({ id, stored, plan, pulled }) => {
    await seedImagePoint(pool, ORIGIN_WORK, id, stored);
    const { bucket, store } = makeImageBucketStub();
    const { fetchImpl, urls } = makeCountingImageFetch(200, new Uint8Array([4, 2]));
    const res = await serveImage({ query, bucket, fetchImpl }, id, plan);
    expect(res.status).toBe(200);
    expect(urls).toEqual([pulled]);
    expect(store.has(`points/${id}`)).toBe(true);
  });
});

databaseDescribe("serveImage answers a redirect from the image origin", () => {
  it("answers 502 to a redirect, storing and recording nothing", async () => {
    await seedImagePoint(pool, ORIGIN_WORK, "redirect-1", "https://image.anitabi.cn/redirect-1.png");
    const { bucket, store } = makeImageBucketStub();
    const { fetchImpl, urls } = makeCountingImageFetch(302, new Uint8Array());
    const res = await serveImage({ query, bucket, fetchImpl }, "redirect-1", ANITABI_THUMBNAIL_PLAN);
    expect(res.status).toBe(502);
    expect(await res.text()).toBe("Upstream error");
    expect(urls).toEqual(["https://image.anitabi.cn/redirect-1.png?plan=h160"]);
    expect(store.size).toBe(0);
    expect(await mediaAssetOf(pool, "redirect-1")).toBeUndefined();
  });
});
