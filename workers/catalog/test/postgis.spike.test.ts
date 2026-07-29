import { afterAll, beforeAll, expect, it } from "vitest";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import pg from "pg";
import {
  databaseDescribe,
  openDirectPool,
  truncateCatalogPool,
} from "./spike-db";

/**
 * THE SPIKE — proves the risky TS stack works end-to-end against a REAL
 * the ephemeral branch's direct cloud Postgres endpoint:
 *   (a) Drizzle raw `sql` template runs a PostGIS ST_DWithin radius query.
 *   (b) The query returns the expected geographic row(s).
 *
 * This deliberately bypasses Neon Local's rejected PostgreSQL-wire proxy.
 */

let pool: pg.Pool;
let db: NodePgDatabase;

beforeAll(async () => {
  pool = await openDirectPool();
  db = drizzle(pool);
  await truncateCatalogPool(pool);

  // Schema mirrors the real `points` table: GEOGRAPHY(Point,4326) location.
  await db.execute(sql`CREATE EXTENSION IF NOT EXISTS postgis`);
  await db.execute(sql`DROP TABLE IF EXISTS spots`);
  await db.execute(sql`
    CREATE TABLE spots (
      id text PRIMARY KEY,
      name text NOT NULL,
      latitude double precision NOT NULL,
      longitude double precision NOT NULL,
      location geography(Point, 4326) NOT NULL
    )
  `);

  // Washinomiya Shrine (Lucky Star) and Oarai (Girls und Panzer) — ~95km apart.
  const wLat = 36.1019;
  const wLon = 139.6586;
  const oLat = 36.3142;
  const oLon = 140.5876;
  await db.execute(sql`
    INSERT INTO spots (id, name, latitude, longitude, location) VALUES
      ('washinomiya', '鷲宮神社', ${wLat}, ${wLon},
        ST_SetSRID(ST_MakePoint(${wLon}, ${wLat}), 4326)::geography),
      ('oarai', '大洗磯前神社', ${oLat}, ${oLon},
        ST_SetSRID(ST_MakePoint(${oLon}, ${oLat}), 4326)::geography)
  `);
}, 120_000);

afterAll(async () => {
  await pool.end();
});

databaseDescribe("PostGIS ST_DWithin via Drizzle raw sql (Hyperdrive simulated by pg)", () => {
  it("finds only the spot inside a 10km radius of Washinomiya", async () => {
    const centerLat = 36.1019;
    const centerLon = 139.6586;
    const radiusMeters = 10_000;

    const rows = (
      await db.execute(sql`
        SELECT
          id,
          name,
          ST_Distance(
            location,
            ST_SetSRID(ST_MakePoint(${centerLon}, ${centerLat}), 4326)::geography
          ) AS distance_m
        FROM spots
        WHERE ST_DWithin(
          location,
          ST_SetSRID(ST_MakePoint(${centerLon}, ${centerLat}), 4326)::geography,
          ${radiusMeters}
        )
        ORDER BY distance_m ASC
      `)
    ).rows as { id: string; name: string; distance_m: number }[];

    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe("washinomiya");
    expect(Number(rows[0]?.distance_m)).toBeLessThan(100); // basically at center
  });

  it("expands radius to 120km and finds both spots, nearest first", async () => {
    const centerLat = 36.1019;
    const centerLon = 139.6586;
    const radiusMeters = 120_000;

    const rows = (
      await db.execute(sql`
        SELECT id
        FROM spots
        WHERE ST_DWithin(
          location,
          ST_SetSRID(ST_MakePoint(${centerLon}, ${centerLat}), 4326)::geography,
          ${radiusMeters}
        )
        ORDER BY location <-> ST_SetSRID(ST_MakePoint(${centerLon}, ${centerLat}), 4326)::geography
      `)
    ).rows as { id: string }[];

    expect(rows.map((r) => r.id)).toEqual(["washinomiya", "oarai"]);
  });
});
