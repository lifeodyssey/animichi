import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import pg from "pg";
import { makeDb, type CatalogDb } from "../src/db/client";
import { serveImage, type ImageFetchLike, type ImgDeps } from "../src/media/img";

/**
 * Spike for the lazy-R2 media path (Wave 6): serveImage over `media_assets`.
 *
 * Reuses the db.spike harness: applies the EXACT points DDL (+ coordinate-sync
 * trigger) and the media_assets DDL sliced from the real migrations to a Docker
 * Postgres+PostGIS, then drives serveImage with an in-memory mock R2Bucket and a
 * call-counting stub fetch. Proves the one-shot pull: first request fetches the
 * origin once + stores it in R2 + writes the media_assets row; the second serves
 * from R2 without re-fetching; an origin-404 tombstones and serves the fallback
 * on this and every later request without re-fetching.
 *
 * Unique container/port (catalog-media-postgis : 55438) so it never clashes with
 * postgis (55432)..enrich (55437) or local Supabase (54322).
 */

const CONTAINER = "catalog-media-postgis";
const IMAGE = "postgis/postgis:16-3.4";
const PG_PORT = 55438;
const PG_PASSWORD = "media";
const CONN = `postgresql://postgres:${PG_PASSWORD}@127.0.0.1:${String(PG_PORT)}/postgres`;

const REMOTE_SCHEMA = "../../supabase/migrations/20260402120000_remote_schema.sql";
const INGEST_SCHEMA = "../../supabase/migrations/20260620230000_ingest_infrastructure.sql";

// Verbatim DDL slices: points (+ its coordinate-sync function/trigger so the
// GEOGRAPHY location column is populated) and the media_assets table.
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
const INGEST_BLOCKS = [{ from: "CREATE TABLE IF NOT EXISTS media_assets (", to: ");" }];

let db: CatalogDb;

function sh(cmd: string): string {
  return execSync(cmd, { stdio: ["ignore", "pipe", "pipe"] }).toString().trim();
}

function sliceBlock(src: string, from: string, to: string): string {
  const start = src.indexOf(from);
  if (start < 0) throw new Error(`marker not found: ${from}`);
  const end = src.indexOf(to, start);
  if (end < 0) throw new Error(`end marker not found: ${to}`);
  return src.slice(start, end + to.length);
}

function startContainer(): void {
  const existing = sh(`docker ps -aq -f name=^${CONTAINER}$`);
  if (existing) sh(`docker rm -f ${CONTAINER}`);
  sh(
    `docker run -d --name ${CONTAINER} -e POSTGRES_PASSWORD=${PG_PASSWORD} ` +
      `-p ${String(PG_PORT)}:5432 ${IMAGE}`,
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
      await probe.end().catch(() => { /* noop */ });
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  throw new Error(`Postgres not ready in time: ${String(lastErr)}`);
}

function readMigration(rel: string): string {
  return readFileSync(resolve(import.meta.dirname, rel), "utf8");
}

function buildSubsetDdl(): string {
  const remote = readMigration(REMOTE_SCHEMA);
  const ingest = readMigration(INGEST_SCHEMA);
  const blocks = [
    ...REMOTE_BLOCKS.map((b) => sliceBlock(remote, b.from, b.to)),
    ...INGEST_BLOCKS.map((b) => sliceBlock(ingest, b.from, b.to)),
  ];
  // `embedding vector(1024)` needs pgvector (absent here) and is never read.
  return blocks.join("\n\n").replace(/^\s*embedding\s+vector\(1024\),\n/m, "");
}

async function seedPoint(id: string, image: string | null): Promise<void> {
  await db.execute(
    sql`INSERT INTO points (id, name, latitude, longitude, image)
        VALUES (${id}, ${"spot"}, ${36.1}, ${139.6}, ${image})`,
  );
}

async function assetOf(pointId: string): Promise<{ r2_key: string | null; tombstoned: boolean } | undefined> {
  const rows = (
    await db.execute(
      sql`SELECT r2_key, tombstoned FROM media_assets WHERE point_id = ${pointId}`,
    )
  ).rows as { r2_key: string | null; tombstoned: boolean }[];
  return rows[0];
}

// In-memory R2Bucket stub: only the get/put surface serveImage exercises.
function mockBucket(): { bucket: R2Bucket; store: Map<string, { body: ArrayBuffer; contentType: string }> } {
  const store = new Map<string, { body: ArrayBuffer; contentType: string }>();
  const bucket = {
    put(key: string, body: ArrayBuffer, opts?: { httpMetadata?: { contentType?: string } }) {
      store.set(key, { body, contentType: opts?.httpMetadata?.contentType ?? "image/jpeg" });
      return Promise.resolve(undefined as unknown as R2Object);
    },
    get(key: string) {
      const hit = store.get(key);
      if (!hit) return Promise.resolve(null);
      return Promise.resolve({
        httpMetadata: { contentType: hit.contentType },
        arrayBuffer: () => Promise.resolve(hit.body),
      });
    },
  };
  return { bucket: bucket as unknown as R2Bucket, store };
}

// Call-counting fetch stub returning bytes (status 200) or a status (404/etc).
function mockFetch(status: number, bytes: Uint8Array): { fetchImpl: ImageFetchLike; calls: () => number } {
  let count = 0;
  const fetchImpl: ImageFetchLike = () => {
    count += 1;
    return Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      headers: { get: (n: string) => (n.toLowerCase() === "content-type" ? "image/png" : null) },
      arrayBuffer: () => Promise.resolve(bytes.buffer.slice(0) as ArrayBuffer),
    });
  };
  return { fetchImpl, calls: () => count };
}

beforeAll(async () => {
  startContainer();
  await waitForReady();
  db = makeDb(CONN);
  await db.execute(sql`CREATE EXTENSION IF NOT EXISTS postgis`);
  await db.execute(sql.raw(buildSubsetDdl()));
}, 120_000);

afterAll(async () => {
  const client = (db as unknown as { $client?: pg.Pool }).$client;
  if (client) await client.end().catch(() => { /* noop */ });
  try {
    sh(`docker rm -f ${CONTAINER}`);
  } catch {
    /* container already gone */
  }
});

describe("serveImage lazy-R2 one-shot pull", () => {
  it("first request fetches origin once, stores in R2, writes media_assets, serves bytes", async () => {
    await seedPoint("ok-1", "https://image.anitabi.cn/ok-1.png");
    const { bucket, store } = mockBucket();
    const { fetchImpl, calls } = mockFetch(200, new Uint8Array([1, 2, 3]));
    const deps: ImgDeps = { db, bucket, fetchImpl };
    const res = await serveImage(deps, "ok-1");
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toContain("public");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
    expect(calls()).toBe(1);
    expect(store.has("points/ok-1")).toBe(true);
    expect((await assetOf("ok-1"))?.r2_key).toBe("points/ok-1");
  });

  it("second request serves from R2 without re-fetching the origin", async () => {
    await seedPoint("ok-2", "https://image.anitabi.cn/ok-2.png");
    const { bucket } = mockBucket();
    const { fetchImpl, calls } = mockFetch(200, new Uint8Array([9, 9]));
    const deps: ImgDeps = { db, bucket, fetchImpl };
    await serveImage(deps, "ok-2");
    const res = await serveImage(deps, "ok-2");
    expect(res.status).toBe(200);
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([9, 9]));
    expect(calls()).toBe(1);
  });
});

describe("serveImage tombstone path", () => {
  it("origin 404 tombstones the asset and serves the fallback", async () => {
    await seedPoint("gone-1", "https://image.anitabi.cn/gone-1.png");
    const { bucket, store } = mockBucket();
    const { fetchImpl, calls } = mockFetch(404, new Uint8Array());
    const res = await serveImage({ db, bucket, fetchImpl }, "gone-1");
    expect(res.status).toBe(404);
    expect(calls()).toBe(1);
    expect(store.size).toBe(0);
    expect((await assetOf("gone-1"))?.tombstoned).toBe(true);
  });

  it("a tombstoned asset serves the fallback on later requests without re-fetching", async () => {
    await seedPoint("gone-2", "https://image.anitabi.cn/gone-2.png");
    const { bucket } = mockBucket();
    const { fetchImpl, calls } = mockFetch(404, new Uint8Array());
    await serveImage({ db, bucket, fetchImpl }, "gone-2");
    const res = await serveImage({ db, bucket, fetchImpl }, "gone-2");
    expect(res.status).toBe(404);
    expect(calls()).toBe(1);
  });
});
