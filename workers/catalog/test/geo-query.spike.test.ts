import { afterAll, beforeAll, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { makeNeonSql, type CatalogDb } from "../src/db/client";
import { findPointsWithinRadius } from "../src/lib/geo-query";
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
 */

let db: CatalogDb;
let neonSql: ReturnType<typeof makeNeonSql>;

async function seedPoints(): Promise<void> {
  // Trigger derives GEOGRAPHY `location` from lat/lon, so insert coordinates only.
  await db.execute(sql`
    INSERT INTO bangumi (id, title) VALUES ('lucky-star', 'らき☆すた')
  `);
  await db.execute(sql`
    INSERT INTO points (id, bangumi_id, name, latitude, longitude) VALUES
      ('washinomiya', 'lucky-star', '鷲宮神社', 36.1019, 139.6586),
      ('satte', 'lucky-star', '幸手権現堂', 36.0833, 139.7250),
      ('kawagoe', 'lucky-star', '川越駅', 35.9077, 139.4828)
  `);
}

beforeAll(async () => {
  db = await openServerlessDb();
  neonSql = makeNeonSql(localDatabaseUrl());
  await truncateCatalog(db);
  await seedPoints();
}, 120_000);

afterAll(() => { restoreNeonConfig(); });

databaseDescribe("findPointsWithinRadius — PostGIS ST_DWithin read primitive", () => {
  it("returns only points inside a 10km radius of Washinomiya", async () => {
    const rows = await findPointsWithinRadius(neonSql, {
      lat: 36.1019,
      lng: 139.6586,
      radiusM: 10_000,
    });
    expect(rows.map((r) => r.id)).toEqual(["washinomiya", "satte"]);
    expect(rows[0]?.distanceM).toBeLessThan(100); // basically at center
    expect(rows[0]?.latitude).toBeCloseTo(36.1019, 4);
  });

  it("excludes Kawagoe at 10km but includes it (nearest-first) at 50km", async () => {
    const near = await findPointsWithinRadius(neonSql, {
      lat: 36.1019,
      lng: 139.6586,
      radiusM: 10_000,
    });
    expect(near.map((r) => r.id)).not.toContain("kawagoe");

    const wide = await findPointsWithinRadius(neonSql, {
      lat: 36.1019,
      lng: 139.6586,
      radiusM: 50_000,
    });
    expect(wide.map((r) => r.id)).toEqual(["washinomiya", "satte", "kawagoe"]);
    const distances = wide.map((r) => r.distanceM);
    expect(distances[0]).toBeLessThan(distances[1] ?? 0);
    expect(distances[1]).toBeLessThan(distances[2] ?? 0);
  });
});
