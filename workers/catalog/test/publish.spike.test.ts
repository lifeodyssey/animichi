import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import pg from "pg";
import { makeDb, type CatalogDb } from "../src/db/client";
import { publishVersion } from "../src/publish/versioning";
import { getRouteSnapshot, saveRouteSnapshot } from "../src/publish/snapshots";
import { gcOldVersions } from "../src/publish/gc";

/**
 * Spike for the Publish stage (card W3-1): atomic version switch over
 * `cluster_version`, no-drift route snapshots over `route_snapshots`, and
 * version GC.
 *
 * Reuses the db.spike harness: applies the EXACT cluster_version / route_snapshots
 * DDL slices (plus their indexes — the partial unique index is the whole point)
 * from the real migration to a Docker Postgres, then drives publishVersion /
 * saveRouteSnapshot / gcOldVersions and reads the rows back. Query-only reads are
 * raw `sql` (the Drizzle read schema does not model these write tables).
 *
 * Unique container/port (catalog-publish-postgis : 55436) so it never clashes
 * with postgis (55432), db (55433), geoquery (55434), ingest (55435), or local
 * Supabase (54322).
 */

const CONTAINER = "catalog-publish-postgis";
const IMAGE = "postgis/postgis:16-3.4";
const PG_PORT = 55436;
const PG_PASSWORD = "publish";
const CONN = `postgresql://postgres:${PG_PASSWORD}@127.0.0.1:${PG_PORT}/postgres`;

const INGEST_SCHEMA = "../../supabase/migrations/20260620230000_ingest_infrastructure.sql";

// Statement markers sliced verbatim out of the real migration — the table DDL
// plus the partial unique index that FORCES the flip-then-insert publish order.
const INGEST_BLOCKS = [
  { from: "CREATE TABLE IF NOT EXISTS cluster_version (", to: ");" },
  { from: "CREATE UNIQUE INDEX IF NOT EXISTS uq_cluster_version_one_current", to: ";" },
  { from: "CREATE TABLE IF NOT EXISTS route_snapshots (", to: ");" },
];

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
  const ingest = readFileSync(resolve(import.meta.dirname, INGEST_SCHEMA), "utf8");
  return INGEST_BLOCKS.map((b) => sliceBlock(ingest, b.from, b.to)).join("\n\n");
}

async function currentVersions(workId: string): Promise<number[]> {
  const rows = (
    await db.execute(
      sql`SELECT version FROM cluster_version WHERE work_id = ${workId} AND is_current ORDER BY version`,
    )
  ).rows as Array<{ version: number }>;
  return rows.map((r) => r.version);
}

async function allVersions(workId: string): Promise<number[]> {
  const rows = (
    await db.execute(
      sql`SELECT version FROM cluster_version WHERE work_id = ${workId} ORDER BY version`,
    )
  ).rows as Array<{ version: number }>;
  return rows.map((r) => r.version);
}

beforeAll(async () => {
  startContainer();
  await waitForReady();
  db = makeDb(CONN);
  await db.execute(sql.raw(buildSubsetDdl()));
}, 120_000);

afterAll(async () => {
  const client = (db as unknown as { $client?: pg.Pool }).$client;
  if (client) await client.end().catch(() => {});
  try {
    sh(`docker rm -f ${CONTAINER}`);
  } catch {
    /* container already gone */
  }
});

describe("publishVersion atomic version switch over cluster_version", () => {
  it("publishes v1 as the single current version", async () => {
    const v = await publishVersion(db, "switch");
    expect(v).toBe(1);
    expect(await currentVersions("switch")).toEqual([1]);
  });

  it("publishes v2: exactly one current row, it is v2, v1 retained non-current", async () => {
    const v = await publishVersion(db, "switch");
    expect(v).toBe(2);
    expect(await currentVersions("switch")).toEqual([2]);
    expect(await allVersions("switch")).toEqual([1, 2]);
  });

  it("never creates two currents under a concurrent double-publish", async () => {
    await Promise.allSettled([
      publishVersion(db, "race"),
      publishVersion(db, "race"),
    ]);
    expect(await currentVersions("race")).toHaveLength(1);
  });
});

describe("saveRouteSnapshot binds a route to a version so it never drifts", () => {
  it("reads back a v1 snapshot unchanged after v2 publishes (no drift)", async () => {
    await publishVersion(db, "drift");
    await saveRouteSnapshot(db, "drift", 1, { order: ["a", "b"] });
    await publishVersion(db, "drift");
    const snap = (await getRouteSnapshot(db, "drift", 1)) as { order: string[] };
    expect(snap.order).toEqual(["a", "b"]);
  });
});

describe("gcOldVersions keeps the newest N and never the current", () => {
  it("removes v1 but never the current version with keep=1", async () => {
    await publishVersion(db, "gc");
    await publishVersion(db, "gc");
    const deleted = await gcOldVersions(db, "gc", 1);
    expect(deleted).toBe(1);
    expect(await allVersions("gc")).toEqual([2]);
    expect(await currentVersions("gc")).toEqual([2]);
  });
});
