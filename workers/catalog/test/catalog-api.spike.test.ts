import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import pg from "pg";
import { makeDb, type CatalogDb } from "../src/db/client";
import app, { closeDbPools } from "../src/index";

/**
 * End-to-end proof for the wired Catalog service (Wave 2 capstone).
 *
 * Boots the REAL Hono `app` (from src/index.ts) against a seeded Docker
 * Postgres+PostGIS, with `DATABASE_URL` pointing at the testcontainer (the
 * local stand-in for the prod Hyperdrive binding). Each call goes through the
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
 * Migration handling mirrors db.spike.test.ts: slice the EXACT catalog DDL out
 * of the real migration files (so column names/types stay authoritative) and
 * skip the `embedding vector(1024)` line the read path never selects.
 */

const CONTAINER = "catalog-api-e2e"; // unique vs db.spike (catalog-db-postgis)
const IMAGE = "postgis/postgis:16-3.4";
const PG_PORT = 55434; // distinct from db.spike (55433), postgis.spike (55432), Supabase (54322)
const PG_PASSWORD = "dbtest";
const CONN = `postgresql://postgres:${PG_PASSWORD}@127.0.0.1:${PG_PORT}/postgres`;

const REMOTE_SCHEMA = "../../supabase/migrations/20260402120000_remote_schema.sql";
const INGEST_SCHEMA = "../../supabase/migrations/20260620230000_ingest_infrastructure.sql";

const REMOTE_BLOCKS = [
  { from: "CREATE TABLE IF NOT EXISTS bangumi (", to: ");" },
  { from: "CREATE OR REPLACE FUNCTION update_updated_at()", to: "$$ LANGUAGE plpgsql;" },
  { from: "CREATE TABLE IF NOT EXISTS points (", to: ");" },
  { from: "CREATE OR REPLACE FUNCTION sync_points_coordinates()", to: "$$ LANGUAGE plpgsql;" },
  {
    from: "CREATE TRIGGER trg_points_sync_coordinates",
    to: "FOR EACH ROW EXECUTE FUNCTION sync_points_coordinates();",
  },
];
const INGEST_BLOCKS = [
  { from: "CREATE TABLE IF NOT EXISTS ingest_jobs (", to: ");" },
  { from: "CREATE TABLE IF NOT EXISTS cluster_version (", to: ");" },
  { from: "CREATE UNIQUE INDEX IF NOT EXISTS uq_cluster_version_one_current", to: ";" },
  { from: "CREATE TABLE IF NOT EXISTS aliases (", to: ");" },
  { from: "CREATE TABLE IF NOT EXISTS series_edges (", to: ");" },
  { from: "CREATE TABLE IF NOT EXISTS leg_cache (", to: ");" },
  { from: "CREATE TABLE IF NOT EXISTS raw_anitabi (", to: ");" },
  { from: "CREATE TABLE IF NOT EXISTS raw_bangumi (", to: ");" },
];

let db: CatalogDb;

function readMigration(rel: string): string {
  return readFileSync(resolve(import.meta.dirname, rel), "utf8");
}

function sliceBlock(src: string, from: string, to: string): string {
  const start = src.indexOf(from);
  if (start < 0) throw new Error(`marker not found: ${from}`);
  const end = src.indexOf(to, start);
  if (end < 0) throw new Error(`end marker not found: ${to}`);
  return src.slice(start, end + to.length);
}

function sh(cmd: string): string {
  return execSync(cmd, { stdio: ["ignore", "pipe", "pipe"] }).toString().trim();
}

function startContainer(): void {
  const existing = sh(`docker ps -aq -f name=^${CONTAINER}$`);
  if (existing) sh(`docker rm -f ${CONTAINER}`);
  sh(
    `docker run -d --name ${CONTAINER} -e POSTGRES_PASSWORD=${PG_PASSWORD} ` +
      `-p ${PG_PORT}:5432 ${IMAGE}`,
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
      await probe.end().catch(() => {});
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  throw new Error(`Postgres not ready in time: ${String(lastErr)}`);
}

function buildSubsetDdl(): string {
  const remote = readMigration(REMOTE_SCHEMA);
  const ingest = readMigration(INGEST_SCHEMA);
  const blocks = [
    ...REMOTE_BLOCKS.map((b) => sliceBlock(remote, b.from, b.to)),
    ...INGEST_BLOCKS.map((b) => sliceBlock(ingest, b.from, b.to)),
  ];
  return blocks.join("\n\n").replace(/^\s*embedding\s+vector\(1024\),\n/m, "");
}

async function applyMigrations(): Promise<void> {
  await db.execute(sql`CREATE EXTENSION IF NOT EXISTS postgis`);
  await db.execute(sql.raw(buildSubsetDdl()));
}

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
    { ENVIRONMENT: "test", DATABASE_URL: CONN },
  );
  expect(res.status).toBe(expectStatus);
  return (await res.json()) as T;
}

beforeAll(async () => {
  startContainer();
  await waitForReady();
  db = makeDb(CONN);
  await applyMigrations();
  await seed();
}, 120_000);

afterEach(() => {
  // Undo any per-test `global.fetch` stub so non-ingest tests stay offline-safe.
  vi.restoreAllMocks();
});

afterAll(async () => {
  // Close BOTH pools before killing the container so in-flight sockets don't
  // surface as an unhandled "Connection terminated" rejection: the test harness
  // pool (`db`) and the app's per-connection cached pool (via closeDbPools).
  await closeDbPools();
  const client = (db as unknown as { $client?: pg.Pool }).$client;
  if (client) await client.end().catch(() => {});
  try {
    sh(`docker rm -f ${CONTAINER}`);
  } catch {
    /* container already gone */
  }
});

interface ApiPoint {
  id: string;
  name: string;
  bangumi_id: string;
  latitude: number;
  longitude: number;
  distance_m?: number;
}

describe("Catalog API end-to-end (Hono app + OpenAPIHandler + Drizzle/PostGIS)", () => {
  it("search resolves the seeded alias to the work's points (plain-JSON wire)", async () => {
    const out = await call<{ rows: ApiPoint[]; synced_at: string }>("search", {
      query: "らき☆すた",
    });
    expect(out.rows.map((r) => r.id).sort()).toEqual(["washinomiya", "washinomiya-torii"]);
    expect(out.rows.every((r) => r.bangumi_id === "lucky-star")).toBe(true);
    expect(typeof out.synced_at).toBe("string");
  });

  it("search returns no rows for an unknown alias", async () => {
    const out = await call<{ rows: ApiPoint[] }>("search", { query: "no-such-anime" });
    expect(out.rows).toHaveLength(0);
  });

  it("spots returns a single representative point for the work (top-level {point})", async () => {
    const out = await call<{ point: ApiPoint; distance_m?: number }>("spots", {
      bangumi_id: "lucky-star",
    });
    expect(out.point.id).toBe("washinomiya");
    expect(out.point.bangumi_id).toBe("lucky-star");
  });

  it("spots 404s when the work has no points", async () => {
    const body = await call<{ code?: string; status?: number }>(
      "spots",
      { bangumi_id: "no-such-work" },
      404,
    );
    expect(body.code).toBe("NOT_FOUND");
  });

  it("nearby returns points within the radius, nearest first with distance_m", async () => {
    const out = await call<{ rows: ApiPoint[] }>("nearby", {
      lat: 36.1019,
      lng: 139.6586,
      radius_m: 1000,
    });
    expect(out.rows.map((r) => r.id)).toEqual(["washinomiya", "washinomiya-torii"]);
    expect(out.rows[0]?.distance_m).toBeGreaterThanOrEqual(0);
    expect(out.rows[1]?.distance_m).toBeGreaterThan(out.rows[0]!.distance_m!);
  });

  it("nearby excludes points outside the radius", async () => {
    const out = await call<{ rows: ApiPoint[] }>("nearby", {
      lat: 35.0,
      lng: 135.0,
      radius_m: 1000,
    });
    expect(out.rows).toHaveLength(0);
  });

  it("route returns a timed itinerary over the selected points (top-level Route)", async () => {
    const out = await call<{
      ordered_points: ApiPoint[];
      point_count: number;
      timed_itinerary: {
        stops: unknown[];
        legs: unknown[];
        total_minutes: number;
        total_distance_m: number;
      };
    }>("route", { point_ids: ["washinomiya", "washinomiya-torii"] });
    expect(out.point_count).toBeGreaterThan(0);
    expect(out.ordered_points.length).toBe(out.point_count);
    expect(out.timed_itinerary.stops.length).toBeGreaterThan(0);
    expect(out.timed_itinerary.total_minutes).toBeGreaterThan(0);
  });
});

// A brand-new work id (not in seed()) so ingest exercises the full fetch ->
// raw -> enrich -> publish pass against the real container DB.
const NEW_WORK_ID = "10380"; // Bangumi subject id (K-On!)
const NEW_TITLE = "けいおん！";

/** Stub upstream JSON for the NEW work: a Bangumi subject + two Anitabi points. */
function stubUpstream(): void {
  const stub = vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes("/v0/subjects/")) return jsonResponse({ name: NEW_TITLE, name_cn: "轻音少女" });
    if (url.includes("/points/detail")) return jsonResponse(ANITABI_POINTS);
    throw new Error(`unexpected upstream url: ${url}`);
  });
  vi.stubGlobal("fetch", stub);
}

// A second uncovered work, reached via the search MISS path (Bangumi search ->
// resolve id -> ingest -> return). Distinct from NEW_WORK_ID so the two ingest
// E2Es don't collide in the shared container DB.
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
  const stub = vi.fn(async (input: string | URL | Request) => {
    urls.push(String(input));
    return searchMissResponse(String(input));
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

describe("Catalog ingest end-to-end (fetch stub -> raw -> enrich -> publish -> search)", () => {
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

describe("Catalog search miss -> Bangumi resolve -> on-demand ingest -> points", () => {
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
