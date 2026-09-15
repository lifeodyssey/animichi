import type { SqlOrmPlan } from "@prisma/orm-postgres/relational-core/types";
import type pg from "pg";
import type { DatabaseFixture } from "./database.ts";
import { RADIUS_METERS, TOKYO_STATION } from "./fixtures.ts";
import type { RecordedQuery } from "./recording-pool.ts";

const ALTER_TO_4269 = "ALTER TABLE geo_points ALTER COLUMN location TYPE geography(Point,4269) USING ST_SetSRID(location::geometry, 4269)::geography";
const ALTER_TO_4326 = "ALTER TABLE geo_points ALTER COLUMN location TYPE geography(Point,4326) USING ST_SetSRID(location::geometry, 4326)::geography";
const DROP_GIST = "DROP INDEX geo_points_location_gist_fb41678c";
const CREATE_GIST = "CREATE INDEX geo_points_location_gist_fb41678c ON public.geo_points USING gist (location)";
const DROP_TRIGRAM = "DROP INDEX geo_points_name_trgm";
const CREATE_TRIGRAM = "CREATE INDEX geo_points_name_trgm ON public.geo_points USING gin (name gin_trgm_ops)";

export function nearbyRows(fixture: DatabaseFixture) {
  return queryPlan(fixture, nearbyPlan);
}

function nearbyPlan(fixture: DatabaseFixture) {
  return fixture.db.sql.public.geo_points
    .select("id", "name")
    .select("distanceM", (fields, operations) => operations.distanceMeters(fields.location, TOKYO_STATION))
    .where((fields, operations) => operations.dwithinMeters(fields.location, TOKYO_STATION, RADIUS_METERS))
    .orderBy((fields, operations) => operations.knnOrder(fields.location, TOKYO_STATION))
    .build();
}

export function trigramRows(fixture: DatabaseFixture) {
  return queryPlan(fixture, trigramPlan);
}

async function queryPlan<Row>(
  fixture: DatabaseFixture,
  build: (fixture: DatabaseFixture) => SqlOrmPlan<Row>,
): Promise<readonly Row[]> {
  return fixture.db.runtime().query(build(fixture));
}

function trigramPlan(fixture: DatabaseFixture) {
  return fixture.db.sql.public.geo_points
    .select("id", "name")
    .select("similarity", (fields, operations) => operations.trigramSimilarity(fields.name, "shibuya"))
    .where((fields, operations) => operations.trigramMatches(fields.name, "shibuya"))
    .orderBy((fields, operations) => operations.trigramSimilarity(fields.name, "shibuya"), { direction: "desc" })
    .orderBy("id")
    .build();
}

export async function sqlPoint(fixture: DatabaseFixture) {
  const plan = fixture.db.sql.public.geo_points
    .select("id", "location")
    .build();
  return (await fixture.db.runtime().query(plan)).find((row) => row.id === "shibuya");
}

export function ormPoint(fixture: DatabaseFixture) {
  return fixture.db.orm.public.GeoPoint.where((point) => point.id.eq("shibuya")).first();
}

export async function formattedColumn(pool: pg.Pool): Promise<string | undefined> {
  const result = await pool.query<{ readonly formatted: string }>(
    "SELECT format_type(atttypid, atttypmod) AS formatted FROM pg_attribute WHERE attrelid = 'geo_points'::regclass AND attname = 'location'",
  );
  return result.rows[0]?.formatted;
}

export async function explain(pool: pg.Pool, statement: RecordedQuery): Promise<unknown> {
  const result = await pool.query<{ readonly "QUERY PLAN": unknown }>(
    `EXPLAIN (FORMAT JSON) ${statement.text}`,
    [...statement.values],
  );
  return result.rows[0]?.["QUERY PLAN"];
}

export type PoolQuery = (pool: pg.Pool) => Promise<unknown>;

export function changeSrid(pool: pg.Pool, srid: 4269 | 4326): Promise<pg.QueryResult> {
  return pool.query(srid === 4269 ? ALTER_TO_4269 : ALTER_TO_4326);
}

export function dropGistIndex(pool: pg.Pool): Promise<pg.QueryResult> {
  return pool.query(DROP_GIST);
}

export function createGistIndex(pool: pg.Pool): Promise<pg.QueryResult> {
  return pool.query(CREATE_GIST);
}

export function dropTrigramIndex(pool: pg.Pool): Promise<pg.QueryResult> {
  return pool.query(DROP_TRIGRAM);
}

export function createTrigramIndex(pool: pg.Pool): Promise<pg.QueryResult> {
  return pool.query(CREATE_TRIGRAM);
}
