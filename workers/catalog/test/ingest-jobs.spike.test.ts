import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import pg from "pg";
import { makeDb, type CatalogDb } from "../src/db/client";
import { JobStore } from "../src/ingest/jobs";
import { saveRawAnitabi, saveRawBangumi } from "../src/ingest/raw-store";

/**
 * Spike for the ingest data layer (card W1-6): JobStore singleflight +
 * negative cache over `ingest_jobs`, and the raw-zone UPSERT round-trip into
 * `raw_anitabi` / `raw_bangumi`.
 *
 * Reuses the db.spike harness: applies the EXACT `ingest_jobs` / raw-zone DDL
 * slices from the real migration to a Docker Postgres, then drives the writers
 * and reads the rows back. Query-only reads are raw `sql` (the Drizzle schema is
 * query-only and does not model these write tables).
 *
 * Unique container/port (catalog-ingest-postgis : 55435) so it never clashes
 * with postgis (55432), db (55433), geoquery (55434), or local Supabase (54322).
 */

const CONTAINER = "catalog-ingest-postgis";
const IMAGE = "postgis/postgis:16-3.4";
const PG_PORT = 55435;
const PG_PASSWORD = "ingest";
const CONN = `postgresql://postgres:${PG_PASSWORD}@127.0.0.1:${String(PG_PORT)}/postgres`;

const INGEST_SCHEMA = "../../supabase/migrations/20260620230000_ingest_infrastructure.sql";

// Statement markers sliced verbatim out of the real migration — keeps the
// applied ingest DDL authoritative without dragging in vector/auth-dependent
// tables. raw_anitabi and raw_bangumi share one CREATE...CREATE region.
const INGEST_BLOCKS = [
  { from: "CREATE TABLE IF NOT EXISTS ingest_jobs (", to: ");" },
  { from: "CREATE TABLE IF NOT EXISTS raw_anitabi (", to: ");" },
  { from: "CREATE TABLE IF NOT EXISTS raw_bangumi (", to: ");" },
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

function buildSubsetDdl(): string {
  const ingest = readFileSync(resolve(import.meta.dirname, INGEST_SCHEMA), "utf8");
  return INGEST_BLOCKS.map((b) => sliceBlock(ingest, b.from, b.to)).join("\n\n");
}

async function statusOf(workId: string): Promise<string | undefined> {
  const rows = (
    await db.execute(sql`SELECT status FROM ingest_jobs WHERE work_id = ${workId}`)
  ).rows as { status: string }[];
  return rows[0]?.status;
}

async function runningCount(workId: string): Promise<number> {
  const rows = (
    await db.execute(
      sql`SELECT COUNT(*)::int AS n FROM ingest_jobs WHERE work_id = ${workId} AND status = 'running'`,
    )
  ).rows as { n: number }[];
  return rows[0]?.n ?? 0;
}

async function backdateNegativeCache(workId: string): Promise<void> {
  await db.execute(
    sql`UPDATE ingest_jobs SET negative_cached_until = NOW() - INTERVAL '1 second' WHERE work_id = ${workId}`,
  );
}

beforeAll(async () => {
  startContainer();
  await waitForReady();
  db = makeDb(CONN);
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

describe("JobStore singleflight over ingest_jobs", () => {
  it("lets exactly one of 20 concurrent acquirers win, leaving one running row", async () => {
    const results = await Promise.all(
      Array.from({ length: 20 }, () => new JobStore(db).acquire("race-1")),
    );
    expect(results.filter((won) => won)).toHaveLength(1);
    expect(await runningCount("race-1")).toBe(1);
  });

  it("markDone flips status to done", async () => {
    const store = new JobStore(db);
    await store.acquire("done-1");
    await store.markDone("done-1");
    expect(await statusOf("done-1")).toBe("done");
  });
});

describe("JobStore negative cache", () => {
  it("blocks re-acquire while negative_cached_until is in the future", async () => {
    const store = new JobStore(db);
    await store.acquire("neg-1");
    await store.markFailed("neg-1", { errorCode: "upstream_500", ttlSeconds: 3600 });
    expect(await store.acquire("neg-1")).toBe(false);
    expect(await statusOf("neg-1")).toBe("failed");
  });

  it("re-acquires once the failure's negative_cached_until TTL has elapsed", async () => {
    const store = new JobStore(db);
    await store.acquire("ttl-1");
    await store.markFailed("ttl-1", { errorCode: "upstream_500", ttlSeconds: 3600 });
    await backdateNegativeCache("ttl-1");
    expect(await store.acquire("ttl-1")).toBe(true);
    expect(await statusOf("ttl-1")).toBe("running");
  });
});

describe("raw-store UPSERT round-trip", () => {
  it("saves and reads back an Anitabi payload, overwriting on re-save", async () => {
    await saveRawAnitabi(db, "raw-a", [{ id: "p1", name: "spot" }]);
    await saveRawAnitabi(db, "raw-a", [{ id: "p1", name: "renamed" }]);
    const rows = (
      await db.execute(sql`SELECT payload FROM raw_anitabi WHERE work_id = 'raw-a'`)
    ).rows as { payload: { name: string }[] }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]?.payload[0]?.name).toBe("renamed");
  });

  it("saves and reads back a Bangumi subject payload", async () => {
    await saveRawBangumi(db, "raw-b", { id: 1, name: "らき☆すた" });
    const rows = (
      await db.execute(sql`SELECT payload FROM raw_bangumi WHERE work_id = 'raw-b'`)
    ).rows as { payload: { name: string } }[];
    expect(rows[0]?.payload.name).toBe("らき☆すた");
  });
});
