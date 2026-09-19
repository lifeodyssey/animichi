import { afterAll, beforeAll, expect, it } from "vitest";
import pg from "pg";
import { MAX_RESULTS, nearbyGeoPort } from "../src/adapters/outbound/nearby-points";
import { acquireCatalogRuntime, catalogPrisma } from "../src/db/prisma";
import { captureNearbyPlan, type NearbyPlanCapture, type PlanNode } from "./nearby-plan";
import { databaseDescribe, planeDatabaseUrl, truncateCatalogPool } from "./integration-db";

/**
 * The nearby query's ONE metric and the plan that serves it (#1628, spec §4.11 /
 * §6.2). Calibrated fixture, on the suite's own Prisma-chain database.
 *
 * 400 points projected EXACTLY 10_000 spheroid metres from Tokyo Station — one
 * per 0.9° of azimuth — plus 8_000 far-away filler rows so the radius predicate
 * stays selective enough for the planner to take the GiST index.
 *
 * Why the ring, and why this size: the two metrics the pre-#1628 code mixed
 * agree on small, unevenly spaced fixtures — a handful of points orders the same
 * under `<->` and `ST_Distance`, so a small fixture lets an ordering regression
 * pass green. On this ring they do not merely reorder, they keep DIFFERENT
 * capped sets: every ring point is 10_000 m away by the spheroid, while its
 * sphere distance spreads from 9_977.44 m (due east) to 10_021.88 m (due west).
 * `ORDER BY <->` therefore keeps the western ring and `ORDER BY ST_Distance`
 * keeps the 200 lowest ids — 100 of the 200 rows differ. The first test asserts
 * that disagreement, so the fixture cannot quietly stop discriminating after a
 * PostGIS or fixture change.
 */

const WORK_ID = "calibration";
const ORIGIN = { lat: 35.6812, lng: 139.7671 };
const ORIGIN_GEOGRAPHY = "ST_SetSRID(ST_MakePoint(139.7671, 35.6812), 4326)::geography";
const RING_AZIMUTHS = 400;
const RING_METRES = 10_000;
const FILLER_ROWS = 8_000;
const RADIUS_M = 20_000;
/** The chain's own DDL, so the index put back after the drop is the same one. */
const INDEX_NAME = "idx_points_location";
const CREATE_POINTS_INDEX = `CREATE INDEX "${INDEX_NAME}" ON "public"."points" USING "gist" ("location")`;

let pool: pg.Pool;
let capture: NearbyPlanCapture;

/** The 200 ascending ids the spheroid metric calls nearest on a tied ring. */
function expectedRing(count: number): readonly string[] {
  return Array.from({ length: count }, (_, index) => `ring-${index.toString().padStart(3, "0")}`);
}

/** The capped id set one ORDER BY expression selects, straight from the database. */
async function cappedSet(orderBy: string): Promise<readonly string[]> {
  const { rows } = await pool.query<{ id: string }>(
    `SELECT id FROM points WHERE ST_DWithin(location, ${ORIGIN_GEOGRAPHY}, $1) ORDER BY ${orderBy} LIMIT $2`,
    [RADIUS_M, MAX_RESULTS],
  );
  return rows.map((row) => row.id);
}

/** The geo plan the adapter really issues, EXPLAINed from the recording pool. */
async function geoPlan(): Promise<readonly PlanNode[]> {
  await nearbyGeoPort(capture.prisma).pointsWithin(ORIGIN.lat, ORIGIN.lng, RADIUS_M);
  return capture.explain("ST_DWithin");
}

/** The `id` sort key the spheroid ordering appends to make the order total. */
function sortKeys(nodes: readonly PlanNode[]): readonly string[] {
  return nodes.flatMap((node) => node.sortKey ?? []);
}

async function seedCalibratedFixture(): Promise<void> {
  await pool.query("INSERT INTO bangumi (id, title) VALUES ($1, $2)", [WORK_ID, "Calibration ring"]);
  await pool.query(
    `INSERT INTO points (id, bangumi_id, name, location)
     SELECT 'ring-' || to_char(g, 'FM000'), $1, 'Ring ' || g,
            ST_Project(${ORIGIN_GEOGRAPHY}, $2::float8, radians(g * 360.0 / $3::float8))::geography
     FROM generate_series(0, $4::int) AS g`,
    [WORK_ID, RING_METRES, RING_AZIMUTHS, RING_AZIMUTHS - 1],
  );
  await pool.query(
    `INSERT INTO points (id, bangumi_id, name, location)
     SELECT 'filler-' || to_char(g, 'FM00000'), $1, 'Filler ' || g,
            ST_SetSRID(ST_MakePoint(130 + (g % 900) / 100.0, 30 + (g % 700) / 100.0), 4326)::geography
     FROM generate_series(0, $2::int) AS g`,
    [WORK_ID, FILLER_ROWS - 1],
  );
  await pool.query("ANALYZE points");
}

beforeAll(async () => {
  pool = new pg.Pool({ connectionString: planeDatabaseUrl(), connectionTimeoutMillis: 10_000 });
  await truncateCatalogPool(pool);
  await seedCalibratedFixture();
  capture = await captureNearbyPlan(planeDatabaseUrl());
}, 120_000);

afterAll(async () => {
  await capture.close();
  await pool.end();
});

databaseDescribe("the fixture discriminates the two metrics (#1628)", () => {
  it("selects a different capped set under the sphere operator than under the spheroid", async () => {
    const spheroid = await cappedSet(`ST_Distance(location, ${ORIGIN_GEOGRAPHY}), id`);
    const sphere = await cappedSet(`location <-> ${ORIGIN_GEOGRAPHY}, id`);
    const sphereOnly = sphere.filter((id) => !spheroid.includes(id));
    expect(spheroid).toEqual(expectedRing(MAX_RESULTS));
    expect(sphere).toHaveLength(MAX_RESULTS);
    expect(sphereOnly).toHaveLength(100);
  });
});

databaseDescribe("the nearby query reports and orders by the spheroid (#1628)", () => {
  it("keeps the spheroid-nearest rows and reports their spheroid metres", async () => {
    const runtime = await acquireCatalogRuntime(planeDatabaseUrl());
    const rows = await nearbyGeoPort(catalogPrisma(runtime)).pointsWithin(ORIGIN.lat, ORIGIN.lng, RADIUS_M);
    await runtime[Symbol.asyncDispose]();
    expect(rows.map((row) => row.id)).toEqual(expectedRing(MAX_RESULTS));
    expect(new Set(rows.map((row) => row.distanceM))).toEqual(new Set([RING_METRES]));
  });
});

databaseDescribe("the nearby query's plan (#1628)", () => {
  it("serves the radius predicate from the GiST index and sorts on the reported metric", async () => {
    const nodes = await geoPlan();
    expect(nodes.filter((node) => node.node === "Seq Scan")).toEqual([]);
    expect(nodes.find((node) => node.index === INDEX_NAME)?.indexCondition).toMatch(/&&/u);
    expect(sortKeys(nodes)).toEqual([expect.stringMatching(/st_distance\(/iu), "id"]);
    expect(sortKeys(nodes).join(" ")).not.toContain("<->");
    expect(nodes.map((node) => node.filter ?? "").join(" ")).toMatch(/st_dwithin\(.*true\)/u);
  });

  it("falls back to a sequential scan when the GiST index is dropped", async () => {
    await pool.query(`DROP INDEX ${INDEX_NAME}`);
    try {
      const nodes = await geoPlan();
      expect(nodes.some((node) => node.node === "Seq Scan")).toBe(true);
    } finally {
      await pool.query(CREATE_POINTS_INDEX);
    }
  });
});
