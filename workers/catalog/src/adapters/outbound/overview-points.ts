/**
 * Overview read adapter — the only SQL on the overview projection path
 * (CATALOG-5 #946). Replaces the api/anime-overview.ts raw row projection.
 */

import { sql } from "drizzle-orm";

/** A published point row as the overview projection reads it. */
export interface OverviewPointRow {
  id: string;
  name: string;
  image: string | null;
  latitude: number;
  longitude: number;
  city: string | null;
}

/** The minimal DB capability this adapter needs. */
export interface OverviewPointsDb {
  execute(query: ReturnType<typeof sql>): Promise<{ rows: unknown[] }>;
}

export function overviewPointsDb(db: OverviewPointsDb): OverviewPointsReader {
  return {
    pointsForWork: (bangumiId) => loadPoints(db, bangumiId),
    workExists: (bangumiId) => loadWorkExists(db, bangumiId),
  };
}

export interface OverviewPointsReader {
  pointsForWork(bangumiId: string): Promise<OverviewPointRow[]>;
  workExists(bangumiId: string): Promise<boolean>;
}

async function loadPoints(db: OverviewPointsDb, bangumiId: string): Promise<OverviewPointRow[]> {
  const result = await db.execute(sql`
    SELECT id, name, image, latitude, longitude, city
    FROM points
    WHERE bangumi_id = ${bangumiId}
    ORDER BY id ASC
  `);
  return result.rows.map(parseRow);
}

async function loadWorkExists(db: OverviewPointsDb, bangumiId: string): Promise<boolean> {
  const result = await db.execute(sql`SELECT id FROM bangumi WHERE id = ${bangumiId} LIMIT 1`);
  return result.rows.length > 0;
}

function parseRow(row: unknown): OverviewPointRow {
  const record = row as Record<string, unknown>;
  return {
    id: String(record.id),
    name: String(record.name),
    image: record.image == null ? null : String(record.image),
    latitude: Number(record.latitude),
    longitude: Number(record.longitude),
    city: record.city == null ? null : String(record.city),
  };
}
