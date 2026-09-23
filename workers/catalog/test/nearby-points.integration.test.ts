import pg from "pg";
import { afterAll, beforeAll, expect, it } from "vitest";
import { nearbyGeoPort, nearbyDetailsPort, MAX_RESULTS } from "../src/adapters/outbound/nearby-points";
import { MAX_RADIUS_M, nearbyPoints } from "../src/application/nearby-points";
import { acquireCatalogRuntime, catalogPrisma, type CatalogPrisma, type CatalogRuntime } from "../src/db/prisma";
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
 * issued, frozen here as the oracle — as the TEXT it rendered rather than as a
 * call that rebuilds it (#1633) — executed on the SAME database this file
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

/** The use case over the real adapters, through one request's Prisma seam. */
function around(lat: number, lng: number, radius_m: number) {
  return nearbyPoints(nearbyGeoPort(prisma), nearbyDetailsPort(prisma), { lat, lng, radius_m });
}

/**
 * The pre-#1628 geo statement, frozen: `ST_DWithin` filter, KNN (`<->`) order,
 * capped, `ST_Distance` reported. Kept verbatim — this is the behaviour the
 * slice replaces, and an oracle that tracks the new code could not measure it.
 *
 * Frozen as the TEXT the pre-#1628 query builder emitted, rather than as a call
 * that rebuilds it. A builder regenerates the oracle on every run, so a library
 * upgrade could move the thing being measured without a line of this file
 * changing; a literal cannot. The text is what
 * `PgDialect().sqlToQuery(<the pre-#1628 builder chain>)` rendered on the tree
 * that still held that chain.
 */
const PRE_1628_GEO_SQL = 'select "id", "name", "latitude", "longitude", ST_Distance("location", ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography) as "distance_m" from "points" where ST_DWithin("points"."location", ST_SetSRID(ST_MakePoint($3, $4), 4326)::geography, $5) order by "points"."location" <-> ST_SetSRID(ST_MakePoint($6, $7), 4326)::geography, "points"."id" asc limit $8';

/**
 * The frozen statement's bound values, in the order its placeholders name them.
 * `ST_MakePoint(x, y)` is (longitude, latitude), and the point appears three
 * times — the reported distance, the radius filter, and the KNN ordering — so
 * the pair repeats before the radius and the cap.
 */
function pre1628GeoParams(lat: number, lng: number, radiusM: number): unknown[] {
  return [lng, lat, lng, lat, radiusM, lng, lat, MAX_RESULTS];
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
  const { rows } = await pool.query(PRE_1628_GEO_SQL, pre1628GeoParams(lat, lng, radiusM));
  return rows as DrizzleGeoRow[];
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
