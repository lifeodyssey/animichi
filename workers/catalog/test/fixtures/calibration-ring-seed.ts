/**
 * The nearby-metric calibration ring (#1628).
 *
 * 400 points projected EXACTLY 10_000 spheroid metres from Tokyo Station — one
 * per 0.9° of azimuth — plus far-away filler rows so the radius predicate stays
 * selective enough for the planner to take the GiST index.
 *
 * The ring MUST be built by PostGIS (`ST_Project`), because the suite asserts
 * the spheroid distance is exactly its metre radius; a JavaScript haversine
 * would land a few metres off and stop discriminating. A generated
 * `INSERT ... SELECT` carries no per-row contract value for a builder to parse,
 * so it lives here rather than in the suite — the work row above it still goes
 * through `workSeed`/`workInsert`.
 */
import type pg from "pg";
import { runSeed, workInsert, type SeedStatement, type WorkSeed } from "./catalog-seed";

/** The origin every nearby assertion measures from. */
export const ORIGIN = { lat: 35.6812, lng: 139.7671 };
export const ORIGIN_GEOGRAPHY = "ST_SetSRID(ST_MakePoint(139.7671, 35.6812), 4326)::geography";

export interface CalibrationRing {
  readonly work: WorkSeed;
  readonly azimuths: number;
  readonly metres: number;
  readonly fillerRows: number;
}

export async function seedCalibrationRing(pool: pg.Pool, ring: CalibrationRing): Promise<void> {
  await runSeed(pool, workInsert([ring.work]));
  for (const statement of generatedPoints(ring)) await runSeed(pool, statement);
  await pool.query("ANALYZE points");
}

function generatedPoints(ring: CalibrationRing): readonly SeedStatement[] {
  return [ringPoints(ring), fillerPoints(ring)];
}

function ringPoints(ring: CalibrationRing): SeedStatement {
  return {
    text: `INSERT INTO points (id, bangumi_id, name, location)
     SELECT 'ring-' || to_char(g, 'FM000'), $1, 'Ring ' || g,
            ST_Project(${ORIGIN_GEOGRAPHY}, $2::float8, radians(g * 360.0 / $3::float8))::geography
     FROM generate_series(0, $4::int) AS g`,
    values: [ring.work.workId, ring.metres, ring.azimuths, ring.azimuths - 1],
  };
}

function fillerPoints(ring: CalibrationRing): SeedStatement {
  return {
    text: `INSERT INTO points (id, bangumi_id, name, location)
     SELECT 'filler-' || to_char(g, 'FM00000'), $1, 'Filler ' || g,
            ST_SetSRID(ST_MakePoint(130 + (g % 900) / 100.0, 30 + (g % 700) / 100.0), 4326)::geography
     FROM generate_series(0, $2::int) AS g`,
    values: [ring.work.workId, ring.fillerRows - 1],
  };
}
