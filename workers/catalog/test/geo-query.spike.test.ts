import { afterAll, beforeAll, expect, it } from "vitest";
import { makeNeonSql, type CatalogDb, type NeonSql } from "../src/db/client";
import { findPointsWithinRadius, MAX_RADIUS_M, type NearbyPoint } from "../src/lib/geo-query";
import {
  pointInsert,
  pointSeed,
  workInsert,
  workSeed,
  type SeedStatement,
} from "./fixtures/catalog-seed";
import {
  databaseDescribe,
  localDatabaseUrl,
  openServerlessDb,
  restoreNeonConfig,
  truncateCatalog,
} from "./spike-db";

/**
 * Spike for the ST_DWithin read primitive (card W1-3).
 *
 * The branch inherits the complete Atlas schema; this file isolates the catalog
 * tables, seeds points, and exercises PostGIS through Neon Local serverless HTTP.
 * Seeds come from the contract-derived fixture builders so an id or coordinate
 * the wire contract rejects fails at construction, not as a mystery empty row.
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

let db: CatalogDb;
let neonSql: NeonSql;

async function run(statement: SeedStatement): Promise<void> {
  await neonSql.query(statement.text, statement.values);
}

async function seed(): Promise<void> {
  await run(workInsert([LUCKY_STAR, GIRLS_UND_PANZER]));
  await run(pointInsert(POINTS));
}

function around(radiusM: number): Promise<NearbyPoint[]> {
  return findPointsWithinRadius(neonSql, {
    lat: WASHINOMIYA.latitude,
    lng: WASHINOMIYA.longitude,
    radiusM,
  });
}

/** Read a seeded row back through the same driver, without the geo predicate. */
async function seededRow(id: string): Promise<unknown> {
  const rows: unknown = await neonSql.query(
    "SELECT id, bangumi_id FROM points WHERE id = $1", [id],
  );
  return rows;
}

beforeAll(async () => {
  db = await openServerlessDb();
  neonSql = makeNeonSql(localDatabaseUrl());
  await truncateCatalog(db);
  await seed();
}, 120_000);

afterAll(() => { restoreNeonConfig(); });

databaseDescribe("findPointsWithinRadius — PostGIS ST_DWithin read primitive", () => {
  it("returns only points inside a 10km radius of Washinomiya", async () => {
    const rows = await around(10_000);
    expect(rows.map((r) => r.id)).toEqual(["washinomiya", "satte"]);
    expect(rows[0]?.distanceM).toBeLessThan(100); // basically at center
  });

  it("adds Kawagoe nearest-first at the maximum radius", async () => {
    const wide = await around(MAX_RADIUS_M);
    expect(wide.map((r) => r.id)).toEqual(["washinomiya", "satte", "kawagoe"]);
    const distances = wide.map((r) => r.distanceM);
    expect(distances[0]).toBeLessThan(distances[1] ?? 0);
    expect(distances[1]).toBeLessThan(distances[2] ?? 0);
  });

  it("clamps an over-cap radius instead of widening the result set", async () => {
    const requested = await around(MAX_RADIUS_M * 4);
    expect(requested.map((r) => r.id)).toEqual(["washinomiya", "satte", "kawagoe"]);
  });

  it("seeds Oarai on its own work — it is the clamp, not an FK gap, that hides it", async () => {
    await expect(seededRow("oarai")).resolves.toEqual([
      { id: "oarai", bangumi_id: GIRLS_UND_PANZER.workId },
    ]);
  });
});
