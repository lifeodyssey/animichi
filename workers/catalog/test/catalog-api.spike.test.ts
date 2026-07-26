import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import type { CatalogDb } from "../src/db/client";
import app, { closeDbPools } from "../src/index";
import {
  databaseDescribe,
  localDatabaseUrl,
  openServerlessDb,
  restoreNeonConfig,
  truncateCatalog,
} from "./spike-db";

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
 * `{point}` / `Route`), NOT the RPCHandler `{json: ...}` envelope. This proves
 * real contract conformance: it would FAIL against the old RPCHandler.
 *
 * Schema comes from the full Atlas-applied `test-base` parent.
 */

let db: CatalogDb;

/**
 * Seed one work (Lucky Star) with two nearby points and a normalized alias.
 * The points trigger derives `location` from latitude/longitude.
 */
async function seed(): Promise<void> {
  await db.execute(sql`
    INSERT INTO bangumi (id, title, title_cn, eps_count, rating, points_count)
    VALUES ('lucky-star', 'らき☆すた', '幸运星', 24, 8.1, 2)
  `);
  await db.execute(sql`
    INSERT INTO points (id, bangumi_id, name, latitude, longitude, episode, time_seconds)
    VALUES
      ('washinomiya', 'lucky-star', '鷲宮神社', 36.1019, 139.6586, 1, 120),
      ('washinomiya-torii', 'lucky-star', '鷲宮神社 鳥居', 36.1025, 139.6590, 1, 60)
  `);
  await db.execute(sql`
    INSERT INTO cluster_version (work_id, version, is_current)
    VALUES ('lucky-star', 1, TRUE)
  `);
  await db.execute(sql`
    INSERT INTO aliases (work_id, alias, alias_normalized, source, priority)
    VALUES ('lucky-star', 'らき☆すた', 'らき☆すた', 'bangumi', 40)
  `);
  await seedOverviewWork();
}

/** A numeric-id work with two co-located Kamakura points + one Hakone point, for
 * the public animeOverview route (its input requires a numeric bangumi_id). */
async function seedOverviewWork(): Promise<void> {
  await db.execute(sql`
    INSERT INTO bangumi (id, title, points_count) VALUES
      ('3302', 'Overview Work', 3),
      ('999998', 'Empty Overview Work', 0)
  `);
  await db.execute(sql`
    INSERT INTO points (id, bangumi_id, name, latitude, longitude, city, image)
    VALUES
      ('ov-kama-1', '3302', '鎌倉A', 35.30660, 139.48890, 'Kamakura', 'https://img/ov1.jpg'),
      ('ov-kama-2', '3302', '鎌倉B', 35.30661, 139.48891, 'Kamakura', NULL),
      ('ov-hakone', '3302', '箱根',  35.23230, 139.10690, 'Hakone',   'https://img/ov3.jpg')
  `);
}

/**
 * POST through the PLAIN-JSON / OpenAPI wire the contract + Python client use:
 * the body IS the raw input object and the response IS the raw output object
 * (no `{ json }` envelope). Optional `expectStatus` for non-200 assertions.
 */
async function call<T>(method: string, payload: unknown, expectStatus = 200): Promise<T> {
  const res = await app.request(
    `/catalog/${method}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    },
    { ENVIRONMENT: "test", DATABASE_URL: localDatabaseUrl() },
  );
  expect(res.status).toBe(expectStatus);
  return (await res.json());
}

/** GET through the public OpenAPI wire (anonymous, no body). Returns the raw
 * response so tests can assert both the JSON body and cache headers. */
async function getPublic(path: string, expectStatus = 200): Promise<Response> {
  const res = await app.request(
    `/catalog/public/${path}`,
    { method: "GET" },
    { ENVIRONMENT: "test", DATABASE_URL: localDatabaseUrl() },
  );
  expect(res.status).toBe(expectStatus);
  return res;
}

beforeAll(async () => {
  db = await openServerlessDb();
  await truncateCatalog(db);
  await seed();
}, 120_000);

afterEach(() => {
  // Undo any per-test `global.fetch` stub so non-ingest tests stay offline-safe.
  vi.restoreAllMocks();
});

afterAll(() => {
  closeDbPools();
  restoreNeonConfig();
});

interface ApiPoint {
  id: string;
  name: string;
  bangumi_id: string;
  latitude: number;
  longitude: number;
  distance_m?: number;
}

async function assertSearchHit(): Promise<void> {
  const out = await call<{ rows: ApiPoint[]; synced_at: string }>("search", { query: "らき☆すた" });
  expect(out.rows.map((r) => r.id).sort()).toEqual(["washinomiya", "washinomiya-torii"]);
  expect(out.rows.every((r) => r.bangumi_id === "lucky-star")).toBe(true);
  expect(typeof out.synced_at).toBe("string");
}

async function assertSearchMiss(): Promise<void> {
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

async function assertNearbyHit(): Promise<void> {
  const out = await call<{ rows: ApiPoint[] }>("nearby", { lat: 36.1019, lng: 139.6586, radius_m: 1000 });
  expect(out.rows.map((r) => r.id)).toEqual(["washinomiya", "washinomiya-torii"]);
  const [nearest, farther] = out.rows;
  expect(nearest?.distance_m).toBeGreaterThanOrEqual(0);
  expect(farther?.distance_m).toBeGreaterThan(nearest?.distance_m ?? Number.NaN);
}

async function assertNearbyMiss(): Promise<void> {
  const out = await call<{ rows: ApiPoint[] }>("nearby", { lat: 35.0, lng: 135.0, radius_m: 1000 });
  expect(out.rows).toHaveLength(0);
}

async function assertRoute(): Promise<void> {
  const out = await call<{
    ordered_points: ApiPoint[];
    point_count: number;
    timed_itinerary: { stops: unknown[]; legs: unknown[]; total_minutes: number; total_distance_m: number };
  }>("route", { point_ids: ["washinomiya", "washinomiya-torii"] });
  expect(out.point_count).toBeGreaterThan(0);
  expect(out.ordered_points.length).toBe(out.point_count);
  expect(out.timed_itinerary.stops.length).toBeGreaterThan(0);
  expect(out.timed_itinerary.total_minutes).toBeGreaterThan(0);
}

interface OverviewBody {
  bangumi_id: string;
  points_length: number;
  circles: { region: string; count: number; lat: number; lng: number }[];
  scenes: { id: string; shot_count: number; screenshot_url: string | null; city?: string }[];
  sample_routes: { region: string; point_ids: string[] }[];
}

async function assertOverviewHit(): Promise<void> {
  const res = await getPublic("anime-overview/3302");
  expect(res.headers.get("Cache-Control")).toContain("s-maxage");
  const body = (await res.json()) as OverviewBody;
  expect(body.points_length).toBe(3);
  expect(body.circles.map((c) => [c.region, c.count])).toEqual([["Kamakura", 2], ["Hakone", 1]]);
  expect(body.scenes[0]).toMatchObject({ id: "ov-kama-1", shot_count: 2, city: "Kamakura" });
  expect(body.sample_routes[0]).toEqual({ region: "Kamakura", point_ids: ["ov-kama-1", "ov-kama-2"] });
}

async function assertOverviewEmpty(): Promise<void> {
  const res = await getPublic("anime-overview/999998");
  const body = (await res.json()) as OverviewBody;
  expect(body).toEqual({
    bangumi_id: "999998",
    points_length: 0,
    circles: [],
    scenes: [],
    sample_routes: [],
  });
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
  it("route returns a timed itinerary over the selected points (top-level Route)", assertRoute);
});

// A brand-new work id (not in seed()) so ingest exercises the full fetch ->
// raw -> enrich -> publish pass against the real suite branch.
const NEW_WORK_ID = "10380"; // Bangumi subject id (K-On!)
const NEW_TITLE = "けいおん！";

/** Stub upstream JSON for the NEW work: a Bangumi subject + two Anitabi points. */
function stubUpstream(): void {
  // The neon serverless driver rides global fetch too (Phase B: the DB channel
  // is HTTP) — pass its /sql traffic through to the real fetch, init included.
  const realFetch = globalThis.fetch;
  const stub = vi.fn((input: string | URL | Request, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : input.toString();
    if (url.includes("/sql")) return realFetch(input, init);
    if (url.includes("/v0/subjects/")) return Promise.resolve(jsonResponse({ name: NEW_TITLE, name_cn: "轻音少女" }));
    if (url.includes("/points/detail")) return Promise.resolve(jsonResponse(ANITABI_POINTS));
    throw new Error(`unexpected upstream url: ${url}`);
  });
  vi.stubGlobal("fetch", stub);
}

// A second uncovered work, reached via the search MISS path (Bangumi search ->
// resolve id -> ingest -> return). Distinct from NEW_WORK_ID so the two ingest
// E2Es don't collide in the shared suite branch.
const MISS_WORK_ID = "100020"; // Bangumi subject id (Hibike! Euphonium)
const MISS_TITLE = "響け！ユーフォニアム";

/**
 * Stub upstream JSON for the search-miss work: the Bangumi SEARCH (POST
 * /v0/search/subjects) resolves the title to MISS_WORK_ID, then the subject +
 * Anitabi points feed the on-demand ingest. Records calls so the test can prove
 * the SECOND search is an alias hit (no re-resolve, no re-ingest).
 */
function stubSearchMiss(): { urls: string[] } {
  const urls: string[] = [];
  const realFetch = globalThis.fetch;
  const stub = vi.fn((input: string | URL | Request, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : input.toString();
    if (url.includes("/sql")) return realFetch(input, init);
    urls.push(url);
    return Promise.resolve(searchMissResponse(url));
  });
  vi.stubGlobal("fetch", stub);
  return { urls };
}

/** Route a stubbed upstream URL to its canned response for the search-miss flow.
 * The miss path now resolves the id, fetches the Anitabi `/lite` preview, then
 * (synchronously here, since the Node harness has no ExecutionContext.waitUntil)
 * runs the full ingest off `/points/detail`. */
function searchMissResponse(url: string): Response {
  if (url.includes("/v0/search/subjects")) return jsonResponse({ data: [{ id: Number(MISS_WORK_ID), name: MISS_TITLE }] });
  if (url.includes("/lite")) return jsonResponse({ pointsLength: MISS_POINTS.length, litePoints: MISS_POINTS });
  if (url.includes("/v0/subjects/")) return jsonResponse({ name: MISS_TITLE, name_cn: "吹响吧！上低音号" });
  if (url.includes("/points/detail")) return jsonResponse(MISS_POINTS);
  throw new Error(`unexpected upstream url: ${url}`);
}

const MISS_POINTS = [
  { id: "uji-bridge", name: "宇治橋", lat: 34.8915, lng: 135.8078, ep: 1, s: 45 },
  { id: "keihan-uji", name: "京阪宇治駅", lat: 34.8908, lng: 135.8112, ep: 1, s: 80 },
];

/** Build a minimal fetch `Response` carrying `body` as JSON. */
function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

const ANITABI_POINTS = [
  { id: "sakuragaoka-gate", name: "桜が丘高校 正門", lat: 34.6571, lng: 135.9486, ep: 1, s: 30 },
  { id: "toyosato-hall", name: "豊郷小学校 講堂", lat: 35.205, lng: 136.2401, ep: 2, s: 90 },
];

databaseDescribe("Catalog ingest end-to-end (fetch stub -> raw -> enrich -> publish -> search)", () => {
  it("POST /ingest publishes the work, then /search returns the fresh points", async () => {
    stubUpstream();

    const ingested = await call<{ status: string; version?: number; point_count?: number }>(
      "ingest",
      { bangumi_id: NEW_WORK_ID },
    );
    expect(ingested.status).toBe("ingested");
    expect(ingested.version).toBe(1);
    expect(ingested.point_count).toBe(ANITABI_POINTS.length);

    const found = await call<{ rows: ApiPoint[] }>("search", { query: NEW_TITLE });
    expect(found.rows.map((r) => r.id).sort()).toEqual(["sakuragaoka-gate", "toyosato-hall"]);
    expect(found.rows.every((r) => r.bangumi_id === NEW_WORK_ID)).toBe(true);
  });
});

databaseDescribe("Catalog search miss -> Bangumi resolve -> on-demand ingest -> points", () => {
  it("an UNCOVERED title resolves+ingests on first search, then is an alias hit on the second", async () => {
    const { urls } = stubSearchMiss();

    const first = await call<{ rows: ApiPoint[] }>("search", { query: MISS_TITLE });
    expect(first.rows.map((r) => r.id).sort()).toEqual(["keihan-uji", "uji-bridge"]);
    expect(first.rows.every((r) => r.bangumi_id === MISS_WORK_ID)).toBe(true);
    expect(urls.some((u) => u.includes("/v0/search/subjects"))).toBe(true);

    const searchCallsAfterFirst = urls.length;
    const second = await call<{ rows: ApiPoint[] }>("search", { query: MISS_TITLE });
    expect(second.rows.map((r) => r.id).sort()).toEqual(["keihan-uji", "uji-bridge"]);
    expect(urls.length).toBe(searchCallsAfterFirst); // alias hit: no re-resolve, no re-ingest
  });
});
