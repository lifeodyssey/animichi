import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import assert from "node:assert/strict";
import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CatalogDb, NeonSql } from "../src/db/client";
import { catalogRouter, type CatalogContext } from "../src/router";

/** Real-Postgres proof for Phase 1a resolver SQL and both additive wire endpoints. */
const CONTAINER = "catalog-resolve-api";
const IMAGE = "postgis/postgis:16-3.4";
const PG_PORT = 55_441;
const PG_PASSWORD = "dbtest";
const CONN = `postgresql://postgres:${PG_PASSWORD}@127.0.0.1:${String(PG_PORT)}/postgres`;
const MIGRATION = "../../../db/migrations/20260623000001_init.sql";
const TABLES = ["bangumi", "points", "aliases"];
const handler = new OpenAPIHandler(catalogRouter);

let pool: pg.Pool;
let db: CatalogDb;

function sh(command: string): string {
  return execSync(command, { stdio: ["ignore", "pipe", "pipe"] }).toString().trim();
}

function startContainer(): void {
  const existing = sh(`docker ps -aq -f name=^${CONTAINER}$`);
  if (existing) sh(`docker rm -f ${CONTAINER}`);
  sh(`docker run -d --name ${CONTAINER} -e POSTGRES_PASSWORD=${PG_PASSWORD} `
    + `-p ${String(PG_PORT)}:5432 ${IMAGE}`);
}

async function canConnect(): Promise<boolean> {
  const probe = new pg.Pool({ connectionString: CONN, max: 1 });
  try {
    await probe.query("SELECT 1");
    return true;
  } catch {
    return false;
  } finally {
    await probe.end().catch(() => undefined);
  }
}

async function waitForReady(): Promise<void> {
  for (let attempt = 0; attempt < 90; attempt += 1) {
    if (await canConnect()) return;
    await new Promise((done) => setTimeout(done, 1000));
  }
  throw new Error("Postgres not ready in time");
}

function sliceTable(source: string, table: string): string {
  const marker = `CREATE TABLE IF NOT EXISTS ${table} (`;
  const start = source.indexOf(marker);
  const end = source.indexOf(");", start);
  if (start < 0 || end < 0) throw new Error(`migration table not found: ${table}`);
  return source.slice(start, end + 2);
}

function resolverDdl(): string {
  const source = readFileSync(resolvePath(import.meta.dirname, MIGRATION), "utf8");
  return TABLES.map((table) => sliceTable(source, table)).join("\n")
    .replace(/^\s*embedding\s+vector\(1024\),\n/m, "");
}

async function seedWorks(): Promise<void> {
  await pool.query(`INSERT INTO bangumi (id, title) VALUES
    ('alpha', 'Alpha'), ('beta', 'Beta'), ('zero', 'Zero Point')`);
}

async function seedPoints(): Promise<void> {
  await pool.query(`INSERT INTO points (id, bangumi_id, name, latitude, longitude) VALUES
    ('a-1', 'alpha', 'Alpha Point', 35, 135),
    ('b-1', 'beta', 'Beta Point 1', 36, 136),
    ('b-2', 'beta', 'Beta Point 2', 37, 137)`);
}

async function seedAliases(): Promise<void> {
  await pool.query(`INSERT INTO aliases (work_id, alias, alias_normalized, source, priority) VALUES
    ('alpha', 'Shared', 'shared', 'bangumi', 40),
    ('alpha', 'Shared', 'shared', 'manual', 40),
    ('beta', 'Shared', 'shared', 'bangumi', 40),
    ('zero', 'Zero', 'zero', 'bangumi', 40)`);
}

function context(): CatalogContext {
  const neonSql = (() => Promise.resolve([])) as unknown as NeonSql;
  return { db, neonSql };
}

async function call(method: string, payload: unknown): Promise<unknown> {
  const request = new Request(`https://catalog.test/catalog/${method}`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const result = await handler.handle(request, { context: context() });
  expect(result.matched).toBe(true);
  assert(result.response);
  expect(result.response.status).toBe(200);
  return result.response.json();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function pointKey(value: unknown): string {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.bangumi_id !== "string") {
    throw new Error("pointsByWorkId returned a malformed row");
  }
  return `${value.bangumi_id}:${value.id}`;
}

function pointKeys(value: unknown): string[] {
  if (!isRecord(value) || !Array.isArray(value.rows)) throw new Error("pointsByWorkId returned no rows");
  return value.rows.map(pointKey).sort();
}

beforeAll(async () => {
  pool = new pg.Pool({ connectionString: CONN });
  startContainer();
  await waitForReady();
  db = drizzle(pool) as unknown as CatalogDb;
  await pool.query("CREATE EXTENSION IF NOT EXISTS postgis");
  await pool.query(resolverDdl());
  await seedWorks();
  await seedPoints();
  await seedAliases();
}, 120_000);

afterAll(async () => {
  await pool.end();
  try {
    sh(`docker rm -f ${CONTAINER}`);
  } catch {
    return;
  }
});

describe("Phase 1a resolver SQL against Postgres", () => {
  it("deduplicates work ids and orders tied candidates by derived point count", async () => {
    await expect(call("resolve", { query: "Shared" })).resolves.toEqual({
      outcome: "needs_disambiguation", reason: "anime_ambiguity",
      candidates: [
        { bangumi_id: "beta", title: "Beta", points_count: 2 },
        { bangumi_id: "alpha", title: "Alpha", points_count: 1 },
      ],
    });
  });

  it("resolves a work with zero points instead of returning not_found", async () => {
    await expect(call("resolve", { query: "Zero" })).resolves.toEqual({
      outcome: "resolved",
      match: { bangumi_id: "zero", title: "Zero Point", points_count: 0 },
    });
  });

  it("returns published rows through pointsByWorkId", async () => {
    const result = await call("points-by-work-id", { work_id: "beta" });
    expect(pointKeys(result)).toEqual(["beta:b-1", "beta:b-2"]);
  });
});
