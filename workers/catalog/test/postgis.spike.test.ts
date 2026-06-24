import { execSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import pg from "pg";

/**
 * THE SPIKE — proves the risky TS stack works end-to-end against a REAL
 * Postgres + PostGIS:
 *   (a) Drizzle raw `sql` template runs a PostGIS ST_DWithin radius query.
 *   (b) The query returns the expected geographic row(s).
 *
 * Hyperdrive is prod-only; locally we connect directly with the `pg` driver
 * (Drizzle's node-postgres adapter), which validates the identical query path.
 */

const CONTAINER = "catalog-spike-postgis";
const IMAGE = "postgis/postgis:16-3.4";
const PG_PORT = 55432; // avoid clashing with local Supabase (54322)
const PG_PASSWORD = "spike";
const CONN = `postgresql://postgres:${PG_PASSWORD}@127.0.0.1:${String(PG_PORT)}/postgres`;

let pool: pg.Pool;
let db: NodePgDatabase;

function sh(cmd: string): string {
  return execSync(cmd, { stdio: ["ignore", "pipe", "pipe"] }).toString().trim();
}

function startContainer(): void {
  const existing = sh(`docker ps -aq -f name=^${CONTAINER}$`);
  if (existing) sh(`docker rm -f ${CONTAINER}`);
  sh(
    `docker run -d --name ${CONTAINER} -e POSTGRES_PASSWORD=${PG_PASSWORD} ` +
      `-p ${String(PG_PORT)}:5432 ${IMAGE}`,
  );
}

async function waitForReady(): Promise<void> {
  const deadline = Date.now() + 90_000;
  let lastErr: unknown;
  while (Date.now() < deadline) {
    try {
      const probe = new pg.Pool({ connectionString: CONN, max: 1 });
      await probe.query("SELECT 1");
      await probe.end();
      return;
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  throw new Error(`Postgres not ready in time: ${String(lastErr)}`);
}

beforeAll(async () => {
  startContainer();
  await waitForReady();
  pool = new pg.Pool({ connectionString: CONN });
  db = drizzle(pool);

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
  try {
    sh(`docker rm -f ${CONTAINER}`);
  } catch {
    /* container already gone */
  }
});

describe("PostGIS ST_DWithin via Drizzle raw sql (Hyperdrive simulated by pg)", () => {
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
