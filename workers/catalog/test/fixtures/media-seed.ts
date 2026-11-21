/**
 * The rows the media integration suites seed and read back. Both go through the
 * pool rather than the seam under test, so a plan that wrote the wrong row cannot
 * also be the thing that reads it back.
 */
import type pg from "pg";
import { pointInsert, pointSeed, workInsert, type WorkSeed } from "./catalog-seed";

/** The `media_assets` columns the serving path branches on, for one point. */
interface MediaAssetRow {
  r2_key: string | null;
  tombstoned: boolean;
}

/** Insert the work every point of a media suite hangs off. */
export async function seedMediaWork(pool: pg.Pool, work: WorkSeed): Promise<void> {
  const insert = workInsert([work]);
  await pool.query(insert.text, insert.values);
}

/** Seed one point on `work` whose stored origin image is `image`. */
export async function seedImagePoint(pool: pg.Pool, work: WorkSeed, id: string, image: string | null): Promise<void> {
  const point = pointInsert([pointSeed(id, work, "spot", 36.1, 139.6)]);
  await pool.query(point.text, point.values);
  await pool.query("UPDATE points SET image = $1 WHERE id = $2", [image, id]);
}

/** The point's `media_assets` row, or `undefined` when nothing was written for it. */
export async function mediaAssetOf(pool: pg.Pool, pointId: string): Promise<MediaAssetRow | undefined> {
  const { rows } = await pool.query("SELECT r2_key, tombstoned FROM media_assets WHERE point_id = $1", [pointId]);
  return (rows as MediaAssetRow[])[0];
}
