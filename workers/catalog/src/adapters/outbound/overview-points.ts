/**
 * Overview read adapter — the only SQL on the overview projection path
 * (CATALOG-5 #946). Replaces the api/anime-overview.ts raw row projection.
 * Built with the Drizzle query builder over the single CatalogDb seam.
 */
import { asc, eq, sql, type SQL } from "drizzle-orm";
import { statementBuilder } from "../../db/client";
import { bangumi, points } from "../../db/schema";

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
  const result = await db.execute(pointsForWorkStatement(bangumiId));
  return result.rows.map(parseRow);
}

/** The work's points in stable id order. */
function pointsForWorkStatement(bangumiId: string): SQL {
  return statementBuilder()
    .select({
      id: points.id, name: points.name, image: points.image,
      latitude: points.latitude, longitude: points.longitude, city: points.city,
    })
    .from(points)
    .where(eq(points.bangumiId, bangumiId))
    .orderBy(asc(points.id))
    .getSQL();
}

async function loadWorkExists(db: OverviewPointsDb, bangumiId: string): Promise<boolean> {
  const result = await db.execute(workExistsStatement(bangumiId));
  return result.rows.length > 0;
}

/** Existence probe on the bangumi row (one row is enough). */
function workExistsStatement(bangumiId: string): SQL {
  return statementBuilder()
    .select({ id: bangumi.id })
    .from(bangumi)
    .where(eq(bangumi.id, bangumiId))
    .limit(1)
    .getSQL();
}

function parseRow(row: unknown): OverviewPointRow {
  const record = row as Record<string, unknown>;
  return {
    id: stringField(record.id),
    name: stringField(record.name),
    image: nullableStringField(record.image),
    latitude: Number(record.latitude),
    longitude: Number(record.longitude),
    city: nullableStringField(record.city),
  };
}

function stringField(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function nullableStringField(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}
