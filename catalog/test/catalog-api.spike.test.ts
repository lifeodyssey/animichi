import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
  { from: "CREATE TABLE IF NOT EXISTS cluster_version (", to: ");" },
  { from: "CREATE TABLE IF NOT EXISTS aliases (", to: ");" },
  { from: "CREATE TABLE IF NOT EXISTS series_edges (", to: ");" },
  { from: "CREATE TABLE IF NOT EXISTS leg_cache (", to: ");" },
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
