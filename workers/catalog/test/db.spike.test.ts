import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import pg from "pg";
import { makeDb, type CatalogDb } from "../src/db/client";
import { aliases, bangumi, clusterVersion, points, seriesEdges } from "../src/db/schema";

/**
 * DB round-trip test for the Catalog read schema (card W1-1).
 *
 * Applies a subset of the REAL repo migrations to a Docker Postgres+PostGIS,
 * then inserts a bangumi + point (with the trigger-synced GEOGRAPHY location)
 * and a few pipeline rows, and reads them back THROUGH the Drizzle schema —
 * proving the pgTable column names/types match the live DDL. Mirrors the spike's
 * container lifecycle (postgis.spike.test.ts). Query-only: inserts here are test
 * fixtures, not schema helpers.
 *
 * Subset rationale: the plain `postgis/postgis` image has neither the `vector`
 * extension nor the Supabase `auth` schema, so the full remote_schema.sql cannot
 * apply as-is. We slice the EXACT DDL for the catalog tables this schema models
 * out of the real migration files (so column names/types stay authoritative) and
 * skip the `embedding vector(1024)` line, which the read path never selects.
 */

const CONTAINER = "catalog-db-postgis";
const IMAGE = "postgis/postgis:16-3.4";
const PG_PORT = 55433; // distinct from the spike (55432) and Supabase (54322)
const PG_PASSWORD = "dbtest";
const CONN = `postgresql://postgres:${PG_PASSWORD}@127.0.0.1:${PG_PORT}/postgres`;

const REMOTE_SCHEMA = "../../supabase/migrations/20260402120000_remote_schema.sql";
const INGEST_SCHEMA = "../../supabase/migrations/20260620230000_ingest_infrastructure.sql";

// Statement markers sliced verbatim out of the real migration files — keeps the
// applied DDL authoritative without dragging in `vector`/`auth`-dependent tables.
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
  // `embedding vector(1024)` requires the pgvector extension (absent on the
  // plain postgis image) and is never read by the Catalog; drop just that line.
  return blocks.join("\n\n").replace(/^\s*embedding\s+vector\(1024\),\n/m, "");
}

async function applyMigrations(): Promise<void> {
  await db.execute(sql`CREATE EXTENSION IF NOT EXISTS postgis`);
  await db.execute(sql.raw(buildSubsetDdl()));
}

beforeAll(async () => {
  startContainer();
  await waitForReady();
  db = makeDb(CONN);
  await applyMigrations();

  // Washinomiya Shrine (Lucky Star). The points trigger derives `location`
  // from latitude/longitude, so we insert coordinates only.
  await db.execute(sql`
    INSERT INTO bangumi (id, title, title_cn, eps_count, rating, points_count)
    VALUES ('lucky-star', 'らき☆すた', '幸运星', 24, 8.1, 1)
  `);
  await db.execute(sql`
    INSERT INTO points (id, bangumi_id, name, latitude, longitude, episode)
    VALUES ('washinomiya', 'lucky-star', '鷲宮神社', 36.1019, 139.6586, 1)
  `);
  await db.execute(sql`
    INSERT INTO cluster_version (work_id, version, is_current)
    VALUES ('lucky-star', 1, TRUE)
  `);
  await db.execute(sql`
    INSERT INTO aliases (work_id, alias, alias_normalized, source, priority)
    VALUES ('lucky-star', 'らき☆すた', 'らきすた', 'bangumi', 10)
  `);
  await db.execute(sql`
    INSERT INTO series_edges (from_work_id, to_work_id, relation)
    VALUES ('lucky-star', 'lucky-star-ova', 'sequel')
  `);
}, 120_000);

afterAll(async () => {
  // Close the pool BEFORE killing the container so in-flight sockets don't
  // surface as an unhandled "Connection terminated" rejection. The pg Pool is
  // exposed via drizzle's `$client`; cast around the workers-types global clash.
  const client = (db as unknown as { $client?: pg.Pool }).$client;
  if (client) await client.end().catch(() => {});
  try {
    sh(`docker rm -f ${CONTAINER}`);
  } catch {
    /* container already gone */
  }
});

describe("Catalog Drizzle read schema round-trips against real migrations", () => {
  it("reads the bangumi row through the typed schema", async () => {
    const rows = await db.select().from(bangumi).where(eq(bangumi.id, "lucky-star"));
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row?.title).toBe("らき☆すた");
    expect(row?.titleCn).toBe("幸运星");
    expect(row?.epsCount).toBe(24);
    expect(row?.pointsCount).toBe(1);
    expect(Number(row?.rating)).toBeCloseTo(8.1, 1);
  });

  it("reads the point row including the trigger-synced geography location", async () => {
    const rows = await db.select().from(points).where(eq(points.id, "washinomiya"));
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row?.name).toBe("鷲宮神社");
    expect(row?.bangumiId).toBe("lucky-star");
    expect(row?.latitude).toBeCloseTo(36.1019, 4);
    expect(row?.longitude).toBeCloseTo(139.6586, 4);
    // The DB trigger populated GEOGRAPHY from lat/lon; the custom type returns
    // the non-null EWKB hex string.
    expect(typeof row?.location).toBe("string");
    expect(row?.location?.length).toBeGreaterThan(0);
  });

  it("reads cluster_version / aliases / series_edges through the schema", async () => {
    const versions = await db
      .select()
      .from(clusterVersion)
      .where(eq(clusterVersion.workId, "lucky-star"));
    expect(versions[0]?.version).toBe(1);
    expect(versions[0]?.isCurrent).toBe(true);

    const aliasRows = await db
      .select()
      .from(aliases)
      .where(eq(aliases.workId, "lucky-star"));
    expect(aliasRows[0]?.aliasNormalized).toBe("らきすた");
    expect(aliasRows[0]?.priority).toBe(10);

    const edges = await db
      .select()
      .from(seriesEdges)
      .where(eq(seriesEdges.fromWorkId, "lucky-star"));
    expect(edges[0]?.toWorkId).toBe("lucky-star-ova");
    expect(edges[0]?.relation).toBe("sequel");
  });

  it("supports a PostGIS radius read joining schema columns with raw sql", async () => {
    const centerLat = 36.1019;
    const centerLon = 139.6586;
    const rows = (
      await db.execute(sql`
        SELECT id
        FROM points
        WHERE ST_DWithin(
          location,
          ST_SetSRID(ST_MakePoint(${centerLon}, ${centerLat}), 4326)::geography,
          1000
        )
      `)
    ).rows as Array<{ id: string }>;
    expect(rows.map((r) => r.id)).toEqual(["washinomiya"]);
  });
});
