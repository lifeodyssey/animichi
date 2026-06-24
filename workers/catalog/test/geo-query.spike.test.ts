import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import pg from "pg";
import { makeDb, makeNeonSql, type CatalogDb } from "../src/db/client";
import { findPointsWithinRadius } from "../src/lib/geo-query";

/**
 * Spike for the ST_DWithin read primitive (card W1-3).
 *
 * Reuses the db.spike.test.ts harness: applies the EXACT `points` DDL slice from
 * the real migrations to a Docker Postgres+PostGIS, inserts points by lat/lon
 * (the trigger derives GEOGRAPHY `location`), then drives `findPointsWithinRadius`
 * and asserts the radius filter + nearest-first distance ordering against a REAL
 * PostGIS. Query-only: inserts are fixtures, not schema helpers.
 *
 * Unique container/port (catalog-geoquery-postgis : 55434) so it never clashes
 * with postgis.spike (55432), db.spike (55433), or local Supabase (54322).
 */

const CONTAINER = "catalog-geoquery-postgis";
const IMAGE = "postgis/postgis:16-3.4";
const PG_PORT = 55434;
const PG_PASSWORD = "geoquery";
const CONN = `postgresql://postgres:${PG_PASSWORD}@127.0.0.1:${String(PG_PORT)}/postgres`;

const REMOTE_SCHEMA = "../../supabase/migrations/20260402120000_remote_schema.sql";

// Statement markers sliced verbatim out of the real migration — keeps the
// applied `points` DDL (incl. the lat/lon -> GEOGRAPHY trigger) authoritative.
const REMOTE_BLOCKS = [
  { from: "CREATE TABLE IF NOT EXISTS bangumi (", to: ");" },
  { from: "CREATE TABLE IF NOT EXISTS points (", to: ");" },
  { from: "CREATE OR REPLACE FUNCTION sync_points_coordinates()", to: "$$ LANGUAGE plpgsql;" },
  {
    from: "CREATE TRIGGER trg_points_sync_coordinates",
    to: "FOR EACH ROW EXECUTE FUNCTION sync_points_coordinates();",
  },
];

let db: CatalogDb;
let neonSql: ReturnType<typeof makeNeonSql>;

function sh(cmd: string): string {
  return execSync(cmd, { stdio: ["ignore", "pipe", "pipe"] }).toString().trim();
}

function sliceBlock(src: string, from: string, to: string): string {
  const start = src.indexOf(from);
  if (start < 0) throw new Error(`marker not found: ${from}`);
  const end = src.indexOf(to, start);
  if (end < 0) throw new Error(`end marker not found: ${to}`);
  return src.slice(start, end + to.length);
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
    const probe = new pg.Pool({ connectionString: CONN, max: 1 });
    try {
      await probe.query("SELECT 1");
      await probe.end();
      return;
    } catch (err) {
      lastErr = err;
      await probe.end().catch(() => { /* noop */ });
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  throw new Error(`Postgres not ready in time: ${String(lastErr)}`);
}

function buildPointsDdl(): string {
  const remote = readFileSync(resolve(import.meta.dirname, REMOTE_SCHEMA), "utf8");
  const ddl = REMOTE_BLOCKS.map((b) => sliceBlock(remote, b.from, b.to)).join("\n\n");
  // `embedding vector(1024)` needs pgvector (absent on the plain postgis image)
  // and is never read by the nearby path; drop just that line.
  return ddl.replace(/^\s*embedding\s+vector\(1024\),\n/m, "");
}

async function seedPoints(): Promise<void> {
  // Trigger derives GEOGRAPHY `location` from lat/lon, so insert coordinates only.
  await db.execute(sql`
    INSERT INTO bangumi (id, title) VALUES ('lucky-star', 'らき☆すた'), ('gup', 'ガールズ&パンツァー')
  `);
  await db.execute(sql`
    INSERT INTO points (id, bangumi_id, name, latitude, longitude) VALUES
      ('washinomiya', 'lucky-star', '鷲宮神社', 36.1019, 139.6586),
      ('satte', 'lucky-star', '幸手権現堂', 36.0833, 139.7250),
      ('oarai', 'gup', '大洗磯前神社', 36.3142, 140.5876)
  `);
}

beforeAll(async () => {
  startContainer();
  await waitForReady();
  db = makeDb(CONN);
  neonSql = makeNeonSql(CONN);
  await db.execute(sql`CREATE EXTENSION IF NOT EXISTS postgis`);
  await db.execute(sql.raw(buildPointsDdl()));
  await seedPoints();
}, 120_000);

afterAll(() => {
  try {
    sh(`docker rm -f ${CONTAINER}`);
  } catch {
    /* container already gone */
  }
});

describe("findPointsWithinRadius — PostGIS ST_DWithin read primitive", () => {
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

  it("excludes far Oarai at 10km but includes it (nearest-first) at 200km", async () => {
    const near = await findPointsWithinRadius(neonSql, {
      lat: 36.1019,
      lng: 139.6586,
      radiusM: 10_000,
    });
    expect(near.map((r) => r.id)).not.toContain("oarai");

    const wide = await findPointsWithinRadius(neonSql, {
      lat: 36.1019,
      lng: 139.6586,
      radiusM: 200_000,
    });
    expect(wide.map((r) => r.id)).toEqual(["washinomiya", "satte", "oarai"]);
    const distances = wide.map((r) => r.distanceM);
    expect(distances[0]).toBeLessThan(distances[1] ?? 0);
    expect(distances[1]).toBeLessThan(distances[2] ?? 0);
  });
});
