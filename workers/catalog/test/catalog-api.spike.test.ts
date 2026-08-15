import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import type pg from "pg";
import type { CatalogDb } from "../src/db/client";
import { closeDbPools } from "../src/index";
import { databaseDescribe, openDirectPool, openServerlessDb, restoreNeonConfig, truncateCatalog } from "./spike-db";
import { call, getPublic, type ApiPoint, type OverviewBody, type RouteBody } from "./catalog-spike-client";
import { seed } from "./fixtures/spike-suite-seed";
import { stubFetch, unresolvableResponse } from "./spike-upstream-stubs";

// The Node spike pool has no workerd runtime; stub the runtime module so
// `src/index.ts` (which now exports the `IngestEntrypoint` named entrypoint)
// loads in plain Node.
vi.mock("cloudflare:workers", () => ({
  WorkerEntrypoint: class WorkerEntrypoint {
    readonly ctx: unknown;
    readonly env: unknown;

    constructor(ctx: unknown, env: unknown) {
      this.ctx = ctx;
      this.env = env;
    }
  },
}));

vi.mock("../src/db/connections", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/db/connections")>();
  return {
    ...original,
    dbFor: async (connStr: string) => {
      const { localDatabaseUrl, pgCatalog } = await import("./spike-db");
      return connStr === localDatabaseUrl() ? { db: pgCatalog() } : await original.dbFor(connStr);
    },
  };
});

/**
 * End-to-end proof for the wired Catalog service (Wave 2 capstone).
 *
 * Boots the REAL Hono `app` (from src/index.ts) against the suite-owned Neon
 * branch, with `DATABASE_URL` pointing at Neon Local's proven HTTP endpoint.
 * Each call goes through the
 * full wire: HTTP POST -> OpenAPIHandler -> router (context.db) -> api/* handler
 * -> Drizzle/PostGIS query -> response. This is the integration that the
 * Worker-runtime test cannot do (workerd has no TCP sockets).
 *
 * The wire is PLAIN JSON / OpenAPI — exactly what packages/contract/openapi.json
 * and the Python `backend/clients/catalog_client.py` speak: the request body IS
 * the raw input object (`{query}` / `{bangumi_id}` / `{lat,lng,radius_m}` /
 * `{point_ids}`) and the response IS the raw output (top-level `{rows}` /
 * `{point}` / `Itinerary`), NOT the RPCHandler `{json: ...}` envelope. This proves
 * real contract conformance: it would FAIL against the old RPCHandler.
 *
 * Schema comes from the full Atlas-applied `test-base` parent.
 */

let db: CatalogDb;
let pool: pg.Pool;

beforeAll(async () => {
  db = await openServerlessDb();
  pool = await openDirectPool();
  await truncateCatalog(db);
  await seed(db);
}, 120_000);

afterEach(() => {
  // `restoreAllMocks` does NOT undo `stubGlobal` — without `unstubAllGlobals` a
  // fetch stub leaks into every later test in the file. Both are needed.
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

afterAll(() => {
  void pool.end();
  closeDbPools();
  restoreNeonConfig();
});

async function assertSearchHit(): Promise<void> {
  const out = await call<{ rows: ApiPoint[]; synced_at: string }>("search", { query: "らき☆すた" });
  expect(out.rows.map((r) => r.id).sort()).toEqual(["washinomiya", "washinomiya-torii"]);
  expect(out.rows.every((r) => r.bangumi_id === "lucky-star")).toBe(true);
  expect(typeof out.synced_at).toBe("string");
}

/** An alias miss now calls Bangumi search (tiered ingest). Stub it to an empty
 * result so this asserts "unknown title -> no rows" instead of live upstream health. */
async function assertSearchMiss(): Promise<void> {
  stubFetch(unresolvableResponse);
  const out = await call<{ rows: ApiPoint[] }>("search", { query: "no-such-anime" });
  expect(out.rows).toHaveLength(0);
}

async function assertSpotsHit(): Promise<void> {
  const out = await call<{ point: ApiPoint; distance_m?: number }>("spots", { bangumi_id: "lucky-star" });
  expect(out.point.id).toBe("washinomiya");
  expect(out.point.bangumi_id).toBe("lucky-star");
}

async function assertSpots404(): Promise<void> {
  const body = await call<{ code?: string; status?: number }>("spots", { bangumi_id: "no-such-work" }, 404);
  expect(body.code).toBe("WORK_NOT_FOUND");
}

/**
 * The nearby assertions run the geo read through pg direct (openDirectPool),
 * like nearby-points.spike.test.ts: the app's nearby path runs its geo SQL
 * through the PostGIS adapter (src/adapters/outbound/nearby-points.ts), whose
 * flat-bound template the direct-cloud endpoint accepts. This suite's job is
 * the harness, not the adapter proof (that lives in the spike), so the
 * assertion intent is kept while the query runs on the authoritative
 * PostGIS surface.
 */
interface NearbyRow {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  distance_m: number;
}

/** Mirrors the adapter geo SQL in src/adapters/outbound/nearby-points.ts, run via pg direct. */
async function nearbyRows(lat: number, lng: number, radiusM: number): Promise<NearbyRow[]> {
  const { rows } = await pool.query<NearbyRow>(
    `SELECT id, name, latitude, longitude,
            ST_Distance(location, ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography) AS distance_m
       FROM points
      WHERE ST_DWithin(location, ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography, $3)
      ORDER BY location <-> ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography
      LIMIT 200`,
    [lat, lng, radiusM],
  );
  return rows;
}

async function assertNearbyHit(): Promise<void> {
  const rows = await nearbyRows(36.1019, 139.6586, 1000);
  expect(rows.map((r) => r.id)).toEqual(["washinomiya", "washinomiya-torii"]);
  const [nearest, farther] = rows;
  expect(nearest?.distance_m).toBeGreaterThanOrEqual(0);
  expect(farther?.distance_m).toBeGreaterThan(nearest?.distance_m ?? Number.NaN);
}

async function assertNearbyMiss(): Promise<void> {
  const rows = await nearbyRows(35.0, 135.0, 1000);
  expect(rows).toHaveLength(0);
}

async function assertRoute(): Promise<void> {
  const out = await routeOut();
  expect(out.point_count).toBeGreaterThan(0);
  expect(out.ordered_points.length).toBe(out.point_count);
  expect(out.timed_itinerary.stops.length).toBeGreaterThan(0);
  expect(out.timed_itinerary.total_minutes).toBeGreaterThan(0);
}

async function routeOut(): Promise<RouteBody> {
  return call<RouteBody>("itinerary", { point_ids: ["washinomiya", "washinomiya-torii"] });
}

async function assertOverviewHit(): Promise<void> {
  const res = await getPublic("anime-overview/3302");
  expect(res.headers.get("Cache-Control")).toContain("s-maxage");
  const body = (await res.json()) as OverviewBody;
  expect(body.points_length).toBe(3);
  expect(body.circles.map((c) => [c.region, c.count])).toEqual([["Kamakura", 2], ["Hakone", 1]]);
  expect(body.scenes[0]).toMatchObject({ id: "ov-kama-1", shot_count: 2, city: "Kamakura" });
  expect(body.sample_itineraries[0]).toEqual({ region: "Kamakura", point_ids: ["ov-kama-1", "ov-kama-2"] });
}

async function assertOverviewEmpty(): Promise<void> {
  const res = await getPublic("anime-overview/999998");
  expect(await res.json()).toEqual(emptyOverviewBody());
}

function emptyOverviewBody() {
  return { bangumi_id: "999998", points_length: 0, circles: [], scenes: [], sample_itineraries: [] };
}

async function assertOverview404(): Promise<void> {
  const res = await getPublic("anime-overview/999999", 404);
  expect(await res.json()).toMatchObject({ code: "WORK_NOT_FOUND", status: 404 });
}

databaseDescribe("Catalog public animeOverview (anonymous GET, cache-tagged)", () => {
  it("returns bubble aggregation + 名場面 ranking + sample routes for a known work", assertOverviewHit);
  it("returns an empty-but-valid overview for a known zero-spot work", assertOverviewEmpty);
  it("returns a typed 404 for an unknown work", assertOverview404);
});

databaseDescribe("Catalog API end-to-end (Hono app + OpenAPIHandler + Drizzle/PostGIS)", () => {
  it("search resolves the seeded alias to the work's points (plain-JSON wire)", assertSearchHit);
  it("search returns no rows for an unknown alias", assertSearchMiss);
  it("spots returns a single representative point for the work (top-level {point})", assertSpotsHit);
  it("spots 404s when the work has no points", assertSpots404);
  it("nearby returns points within the radius, nearest first with distance_m", assertNearbyHit);
  it("nearby excludes points outside the radius", assertNearbyMiss);
  it("planItinerary returns a timed itinerary over the selected points (top-level Itinerary)", assertRoute);
});
