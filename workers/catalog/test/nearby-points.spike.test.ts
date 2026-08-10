import { afterAll, beforeAll, expect, it } from "vitest";
import type pg from "pg";
import { MAX_RADIUS_M, nearbyPoints } from "../src/application/nearby-points";
import { nearbyDetailsPort, nearbyGeoPort } from "../src/adapters/outbound/nearby-points";
import type { CatalogDb, NeonSql } from "../src/db/client";
import {
  pointInsert,
  pointSeed,
  workInsert,
  workSeed,
  type SeedStatement,
} from "./fixtures/catalog-seed";
import { databaseDescribe, openDirectPool, openServerlessDb, truncateCatalogPool } from "./spike-db";

/**
 * Integration for the nearby path (card CATALOG-3): the REAL PostGIS adapter
 * (`nearbyGeoPort`) driven by the `nearbyPoints` use case end-to-end against
 * the ephemeral branch. The geo read runs through pg direct (the neon_local
 * proxy #883 mangles geography bytea over the serverless fetch protocol), with
 * the adapter's `neon()` template bound over `pg.Pool` — the same SQL, the
 * same adapter code. Detail enrichment runs through the serverless Drizzle
 * client (plain SQL, no geometry). Seeds come from contract-derived fixture
 * builders so an id or coordinate the wire contract rejects fails at
 * construction, not as a mystery empty row.
 *
 * This is the [integration] AC: boundary radii, deterministic nearest-first
 * ordering, typed empty results, and database failure through the real
 * PostGIS adapter.
 */

const LUCKY_STAR = workSeed("3701", "らき☆すた");
const GIRLS_UND_PANZER = workSeed("7724", "ガールズ&パンツァー");

const WASHINOMIYA = pointSeed("washinomiya", LUCKY_STAR, "鷲宮神社", 36.1019, 139.6586);
const POINTS = [
  WASHINOMIYA,
  pointSeed("satte", LUCKY_STAR, "幸手権現堂", 36.0833, 139.725),
  pointSeed("kawagoe", LUCKY_STAR, "川越駅", 35.9077, 139.4828),
  // ~82 km away: outside MAX_RADIUS_M, so it proves the clamp rather than an FK gap.
  pointSeed("oarai", GIRLS_UND_PANZER, "大洗磯前神社", 36.3142, 140.5876),
];

/** Bind the adapter's `neon()` template over a pg pool (same interpolation shape). */
function neonSqlOver(pool: pg.Pool): NeonSql {
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = String.raw(strings, ...values.map((_, index) => `$${String(index + 1)}`));
    return pool.query<Record<string, unknown>>(text, values).then((result) => result.rows);
  };
  return Object.assign(tag, { transaction: undefined }) as unknown as NeonSql;
}

let pool: pg.Pool;
let db: CatalogDb;

async function run(statement: SeedStatement): Promise<void> {
  await pool.query(statement.text, statement.values);
}

async function seed(): Promise<void> {
  await run(workInsert([LUCKY_STAR, GIRLS_UND_PANZER]));
  await run(pointInsert(POINTS));
}

/** The use case over the real adapters: geo via pg direct, details via Drizzle. */
function around(lat: number, lng: number, radius_m: number) {
  return nearbyPoints(nearbyGeoPort(neonSqlOver(pool)), nearbyDetailsPort(db), { lat, lng, radius_m });
}

/** Read a seeded row back through the same driver, without the geo predicate. */
async function seededRow(id: string): Promise<unknown> {
  const { rows } = await pool.query("SELECT id, bangumi_id FROM points WHERE id = $1", [id]);
  return rows;
}

beforeAll(async () => {
  pool = await openDirectPool();
  db = await openServerlessDb();
  await truncateCatalogPool(pool);
  await seed();
}, 120_000);

afterAll(async () => {
  await pool.end();
});

databaseDescribe("nearbyPoints through the PostGIS adapter", () => {
  it("returns only points inside a 10km radius of Washinomiya, nearest first", async () => {
    const { rows } = await around(36.1019, 139.6586, 10_000);
    expect(rows.map((row) => row.id)).toEqual(["washinomiya", "satte"]);
    expect(rows[0]?.distance_m).toBeLessThan(100); // basically at center
  });

  it("returns the center point at the lower radius boundary", async () => {
    const { rows } = await around(36.1019, 139.6586, 1);
    expect(rows.map((row) => row.id)).toEqual(["washinomiya"]);
  });

  it("adds Kawagoe nearest-first at the maximum radius", async () => {
    const { rows } = await around(36.1019, 139.6586, MAX_RADIUS_M);
    expect(rows.map((row) => row.id)).toEqual(["washinomiya", "satte", "kawagoe"]);
    const distances = rows.map((row) => row.distance_m ?? 0);
    expect(distances[0]).toBeLessThan(distances[1] ?? 0);
    expect(distances[1]).toBeLessThan(distances[2] ?? 0);
  });

  it("clamps an over-cap radius instead of widening the result set", async () => {
    const clamped = await around(36.1019, 139.6586, MAX_RADIUS_M * 4);
    expect(clamped.rows.map((row) => row.id)).toEqual(["washinomiya", "satte", "kawagoe"]);
  });

  it("returns a typed empty result outside the radius", async () => {
    const { rows } = await around(35.0, 135.0, 1_000);
    expect(rows).toEqual([]);
  });

  it("merges detail columns from the serverless read onto the rows", async () => {
    const { rows } = await around(36.1019, 139.6586, 10_000);
    expect(rows[0]).toMatchObject({ name_cn: "鹫宮神社", bangumi_id: "lucky-star" });
  });

  it("propagates a database failure from the PostGIS read", async () => {
    const dead = await openDirectPool();
    await dead.end();
    await expect(
      nearbyPoints(nearbyGeoPort(neonSqlOver(dead)), nearbyDetailsPort(db), {
        lat: 36.1019, lng: 139.6586, radius_m: 1_000,
      }),
    ).rejects.toThrow();
  });

  it("seeds Oarai on its own work — it is the clamp, not an FK gap, that hides it", async () => {
    await expect(seededRow("oarai")).resolves.toEqual([
      { id: "oarai", bangumi_id: GIRLS_UND_PANZER.workId },
    ]);
  });
});
