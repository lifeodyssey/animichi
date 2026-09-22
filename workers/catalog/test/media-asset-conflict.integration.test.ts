import pg from "pg";
import { afterAll, beforeAll, expect, it } from "vitest";
import { ANITABI_THUMBNAIL_PLAN } from "@animichi/contract/anitabi-display";
import { serveImage } from "../src/media/img";
import { acquireCatalogRuntime, catalogPrisma, type CatalogPrisma, type CatalogRuntime } from "../src/db/prisma";
import { databaseDescribe, planeDatabaseUrl, truncateCatalogPool } from "./integration-db";
import { pointInsert, pointSeed, workInsert, workSeed } from "./fixtures/catalog-seed";
import { makeImageBucketStub, makeCountingImageFetch } from "./media-doubles";

/**
 * What the two `media_assets` writes do when the row is already there (#1633).
 *
 * `media.integration.test.ts` drives the serving decisions, and every path it
 * takes INSERTs or writes nothing: a first request creates the row, and every
 * later one is answered from R2 or from the tombstone before a write is
 * attempted. So the conflict arm — the half `ON CONFLICT … DO UPDATE` exists
 * for — has no coverage there, which is why it is this file's whole subject.
 *
 * It is reachable through a row that claims NEITHER outcome: no `r2_key`, not
 * tombstoned. Removing the conflict clause from `stampedUpsert` turns both tests
 * below red with `duplicate key value violates unique constraint
 * "media_assets_pkey"`.
 */

let pool: pg.Pool;
let runtime: CatalogRuntime;
let query: CatalogPrisma;

const CLASH_WORK = workSeed("7724", "ガールズ&パンツァー");

beforeAll(async () => {
  pool = new pg.Pool({ connectionString: planeDatabaseUrl(), connectionTimeoutMillis: 10_000 });
  await truncateCatalogPool(pool);
  const work = workInsert([CLASH_WORK]);
  await pool.query(work.text, work.values);
  runtime = await acquireCatalogRuntime(planeDatabaseUrl());
  query = catalogPrisma(runtime);
}, 120_000);

afterAll(async () => {
  await runtime[Symbol.asyncDispose]();
  await pool.end();
});

/** Seed a point carrying an origin image URL, plus a row that resolves nothing. */
async function seedPointWithBareAsset(id: string): Promise<void> {
  const point = pointInsert([pointSeed(id, CLASH_WORK, "spot", 36.1, 139.6)]);
  await pool.query(point.text, point.values);
  await pool.query("UPDATE points SET image = $1 WHERE id = $2", [`https://image.anitabi.cn/${id}.png`, id]);
  await pool.query("INSERT INTO media_assets (point_id) VALUES ($1)", [id]);
}

async function assetOf(pointId: string): Promise<{ r2_key: string | null; tombstoned: boolean; last_origin_pull: string | null } | undefined> {
  const { rows } = await pool.query(
    "SELECT r2_key, tombstoned, last_origin_pull FROM media_assets WHERE point_id = $1", [pointId],
  );
  return (rows as { r2_key: string | null; tombstoned: boolean; last_origin_pull: string | null }[])[0];
}

/** One request over a seeded clash, with the origin answering `status`. */
async function serveOverClash(id: string, status: number, bytes: Uint8Array): Promise<void> {
  const { fetchImpl } = makeCountingImageFetch(status, bytes);
  const { bucket } = makeImageBucketStub();
  await serveImage({ query, bucket, fetchImpl }, id, ANITABI_THUMBNAIL_PLAN);
}

databaseDescribe("serveImage over an existing, unresolved media_assets row", () => {
  it("overwrites the bare row with the stored key and the server's pull time", async () => {
    await seedPointWithBareAsset("clash-1");
    expect((await assetOf("clash-1"))?.last_origin_pull).toBeNull();

    await serveOverClash("clash-1", 200, new Uint8Array([7]));

    const asset = await assetOf("clash-1");
    expect(asset?.r2_key).toBe("points/clash-1");
    expect(asset?.last_origin_pull).not.toBeNull();
  });

  it("overwrites the bare row with the tombstone when the origin is gone", async () => {
    await seedPointWithBareAsset("clash-2");

    await serveOverClash("clash-2", 404, new Uint8Array());

    const asset = await assetOf("clash-2");
    expect(asset?.tombstoned).toBe(true);
    expect(asset?.last_origin_pull).not.toBeNull();
  });
});
