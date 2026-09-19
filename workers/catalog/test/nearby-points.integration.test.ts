import { asc, type SQL } from "drizzle-orm";
import pg from "pg";
import { afterAll, beforeAll, expect, it } from "vitest";
import { nearbyGeoPort, nearbyDetailsPort, MAX_RESULTS } from "../src/adapters/outbound/nearby-points";
import { MAX_RADIUS_M, nearbyPoints } from "../src/application/nearby-points";
import { statementBuilder, type CatalogDb } from "../src/db/client";
import * as x from "../src/db/expressions";
import { acquireCatalogRuntime, catalogPrisma, type CatalogPrisma, type CatalogRuntime } from "../src/db/prisma";
import { points as pointsTable } from "../src/db/schema";
import { makePgCatalog } from "./integration-db-global/pg-catalog";
import { databaseDescribe, planeDatabaseUrl, truncateCatalogPool } from "./integration-db";
import { seedNearbyPoints, WASHINOMIYA_ORIGIN } from "./nearby-points.fixtures";

/**
 * Integration for the nearby path (card CATALOG-3; moved onto the Prisma data
 * plane by #1628): the REAL PostGIS adapter (`nearbyGeoPort`) driven by the
 * `nearbyPoints` use case end-to-end against a database the committed Prisma
 * chain built. Both reads cross one request's `CatalogPrisma` seam, and the geo
 * read runs over the request's own TCP runtime — the geography pack decodes the
 * `location` column, so there is no separate driver arm to route around.
 *
 * EQUIVALENCE (AC1): `drizzleGeoRows` is the statement the pre-#1628 adapter
 * issued, frozen here as the oracle, executed on the SAME database this file
 * seeds. `keeps the rows, the order and the reported metres of the Drizzle path`
 * compares the two row-for-row, so "the same results as before" is measured
 * rather than asserted. The one deliberate difference — the ordering expression
 * at the `MAX_RESULTS` cap — belongs to the fixture shapes where the sphere and
 * the spheroid disagree; `nearby-metric.integration.test.ts` owns it, and this
 * file's four-point fixture is one where they agree.
 *
 * This is the [integration] AC: boundary radii, deterministic nearest-first
 * ordering, typed empty results, and database failure through the real PostGIS
 * adapter.
 */

let pool: pg.Pool;
let runtime: CatalogRuntime;
let prisma: CatalogPrisma;
let drizzle: CatalogDb;

/** The use case over the real adapters, through one request's Prisma seam. */
function around(lat: number, lng: number, radius_m: number) {
  return nearbyPoints(nearbyGeoPort(prisma), nearbyDetailsPort(prisma), { lat, lng, radius_m });
}

/**
 * The pre-#1628 geo statement, frozen: `ST_DWithin` filter, KNN (`<->`) order,
 * capped, `ST_Distance` reported. Kept verbatim — this is the behaviour the
 * slice replaces, and an oracle that tracks the new code could not measure it.
 */
function drizzleGeoStatement(lat: number, lng: number, radiusM: number): SQL {
  const point = x.geoPoint(lat, lng);
  return statementBuilder()
    .select({
      id: pointsTable.id, name: pointsTable.name,
      latitude: pointsTable.latitude, longitude: pointsTable.longitude,
      distanceM: x.distanceMeters(pointsTable.location, point).as("distance_m"),
    })
    .from(pointsTable)
    .where(x.withinMeters(pointsTable.location, point, radiusM))
    .orderBy(x.knnDistance(pointsTable.location, point), asc(pointsTable.id))
    .limit(MAX_RESULTS)
    .getSQL();
}

/** The pre-#1628 adapter's row shape, alias included — the oracle's own names. */
interface DrizzleGeoRow {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  distance_m: number;
}

/** The Drizzle path's rows for the same query, as the pre-#1628 adapter read them. */
async function drizzleGeoRows(lat: number, lng: number, radiusM: number): Promise<DrizzleGeoRow[]> {
  const result = await drizzle.execute(drizzleGeoStatement(lat, lng, radiusM));
  return result.rows as unknown as DrizzleGeoRow[];
}

/** Read a seeded row back through pg direct, without the geo predicate. */
async function seededRow(id: string): Promise<unknown> {
  const { rows } = await pool.query("SELECT id, bangumi_id FROM points WHERE id = $1", [id]);
  return rows;
}

beforeAll(async () => {
  pool = new pg.Pool({ connectionString: planeDatabaseUrl(), connectionTimeoutMillis: 10_000 });
  await truncateCatalogPool(pool);
  await seedNearbyPoints(pool);
  runtime = await acquireCatalogRuntime(planeDatabaseUrl());
  prisma = catalogPrisma(runtime);
  drizzle = makePgCatalog(pool);
}, 120_000);

afterAll(async () => {
  await runtime[Symbol.asyncDispose]();
  await pool.end();
});

databaseDescribe("nearbyPoints through the PostGIS adapter (#1628)", () => {
  it("returns only points inside a 10km radius of Washinomiya, nearest first", async () => {
    const { rows } = await around(WASHINOMIYA_ORIGIN.lat, WASHINOMIYA_ORIGIN.lng, 10_000);
    expect(rows.map((row) => row.id)).toEqual(["washinomiya", "satte"]);
    expect(rows[0]?.distance_m).toBeLessThan(100); // basically at center
  });

  it("returns the center point at the lower radius boundary", async () => {
    const { rows } = await around(WASHINOMIYA_ORIGIN.lat, WASHINOMIYA_ORIGIN.lng, 1);
    expect(rows.map((row) => row.id)).toEqual(["washinomiya"]);
  });

  it("adds Kawagoe nearest-first at the maximum radius", async () => {
    const { rows } = await around(WASHINOMIYA_ORIGIN.lat, WASHINOMIYA_ORIGIN.lng, MAX_RADIUS_M);
    expect(rows.map((row) => row.id)).toEqual(["washinomiya", "satte", "kawagoe"]);
    const distances = rows.map((row) => row.distance_m ?? 0);
    expect(distances[0]).toBeLessThan(distances[1] ?? 0);
    expect(distances[1]).toBeLessThan(distances[2] ?? 0);
  });

  it("clamps an over-cap radius instead of widening the result set", async () => {
    const clamped = await around(WASHINOMIYA_ORIGIN.lat, WASHINOMIYA_ORIGIN.lng, MAX_RADIUS_M * 4);
    expect(clamped.rows.map((row) => row.id)).toEqual(["washinomiya", "satte", "kawagoe"]);
  });

  it("returns a typed empty result outside the radius", async () => {
    const { rows } = await around(35.0, 135.0, 1_000);
    expect(rows).toEqual([]);
  });
});

databaseDescribe("the nearby path's rows and failures (#1628)", () => {
  it("merges detail columns from the detail read onto the rows", async () => {
    const { rows } = await around(WASHINOMIYA_ORIGIN.lat, WASHINOMIYA_ORIGIN.lng, 10_000);
    expect(rows[0]).toMatchObject({
      name: "鷲宮神社",
      bangumi_id: "3701",
      screenshot_url: "https://img/washinomiya.jpg",
      episode: 1,
      time_seconds: 12,
      origin: "anitabi",
      origin_url: "https://anitabi.cn/washinomiya",
      city: "Kuki",
    });
  });

  it("keeps the rows, the order and the reported metres of the Drizzle path (AC1)", async () => {
    const origin = WASHINOMIYA_ORIGIN;
    const drizzleRows = await drizzleGeoRows(origin.lat, origin.lng, MAX_RADIUS_M);
    const { rows } = await around(origin.lat, origin.lng, MAX_RADIUS_M);
    expect(rows.map((row) => row.id)).toEqual(drizzleRows.map((row) => row.id));
    expect(rows.map((row) => row.distance_m)).toEqual(drizzleRows.map((row) => row.distance_m));
    expect(rows.map((row) => [row.latitude, row.longitude])).toEqual(
      drizzleRows.map((row) => [row.latitude, row.longitude]),
    );
  });

  it("propagates a database failure from the PostGIS read", async () => {
    const spent = await acquireCatalogRuntime(planeDatabaseUrl());
    const spentPrisma = catalogPrisma(spent);
    await spent[Symbol.asyncDispose]();
    const failure = await nearbyPoints(
      nearbyGeoPort(spentPrisma), nearbyDetailsPort(spentPrisma), {
        lat: WASHINOMIYA_ORIGIN.lat, lng: WASHINOMIYA_ORIGIN.lng, radius_m: 1_000,
      },
    ).then(() => null, (error: unknown) => error);
    expect(failure).toBeInstanceOf(Error);
  });

  it("seeds Oarai on its own work — it is the clamp, not an FK gap, that hides it", async () => {
    await expect(seededRow("oarai")).resolves.toEqual([{ id: "oarai", bangumi_id: "7724" }]);
  });
});
