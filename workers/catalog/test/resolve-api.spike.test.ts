import assert from "node:assert/strict";
import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { afterAll, beforeAll, expect, it } from "vitest";
import { makeNeonSql, type CatalogDb, type NeonSql } from "../src/db/client";
import { catalogRouter, type CatalogContext } from "../src/router";
import {
  aliasInsert,
  aliasSeed,
  ambiguousOutcome,
  candidateOf,
  pointInsert,
  pointSeed,
  resolvedOutcome,
  workInsert,
  workSeed,
  type SeedStatement,
} from "./fixtures/catalog-seed";
import {
  databaseDescribe,
  localDatabaseUrl,
  openDirectPool,
  openServerlessDb,
  restoreNeonConfig,
  truncateCatalogPool,
} from "./spike-db";

/**
 * Resolver SQL proof against the ephemeral branch's direct cloud endpoint.
 *
 * GUARD: the context must carry a REAL `NeonSql` built from the spike DSN.
 * Resolve's raw-SQL path (the July geocoding wave) is part of its contract, so
 * stubbing `neonSql` to something like `() => Promise.resolve([])` does not
 * fail loudly — it silently turns every resolve into a miss and an on-demand
 * ingest. Do not stub it.
 *
 * Seeds and expectations are built by `./fixtures/catalog-seed`, so a work id
 * that `pointsByWorkId` would reject with a 400 cannot be written here (#363).
 */
const handler = new OpenAPIHandler(catalogRouter);

const ALPHA = workSeed("1001", "Alpha");
const BETA = workSeed("1002", "Beta");
const ZERO = workSeed("1003", "Zero Point");

const POINTS = [
  pointSeed("a-1", ALPHA, "Alpha Point", 35, 135),
  pointSeed("b-1", BETA, "Beta Point 1", 36, 136),
  pointSeed("b-2", BETA, "Beta Point 2", 37, 137),
];

const ALIASES = [
  aliasSeed(ALPHA, "Shared", "shared", "bangumi", 40),
  aliasSeed(ALPHA, "Shared", "shared", "manual", 40),
  aliasSeed(BETA, "Shared", "shared", "bangumi", 40),
  aliasSeed(ZERO, "Zero", "zero", "bangumi", 40),
];

let pool: pg.Pool;
let db: CatalogDb;
let neonSql: NeonSql;

async function run(statement: SeedStatement): Promise<void> {
  await pool.query(statement.text, statement.values);
}

async function seed(): Promise<void> {
  await run(workInsert([ALPHA, BETA, ZERO]));
  await run(pointInsert(POINTS));
  await run(aliasInsert(ALIASES));
}

function context(): CatalogContext {
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
  await openServerlessDb();
  neonSql = makeNeonSql(localDatabaseUrl());
  pool = await openDirectPool();
  db = drizzle(pool) as unknown as CatalogDb;
  await truncateCatalogPool(pool);
  await seed();
}, 120_000);

afterAll(async () => {
  restoreNeonConfig();
  await pool.end();
});

databaseDescribe("Phase 1a resolver SQL against Postgres", () => {
  it("deduplicates work ids and orders tied candidates by derived point count", async () => {
    await expect(call("resolve", { query: "Shared" }))
      .resolves.toEqual(ambiguousOutcome([candidateOf(BETA, 2), candidateOf(ALPHA, 1)]));
  });

  it("resolves a work with zero points instead of returning not_found", async () => {
    await expect(call("resolve", { query: "Zero" })).resolves.toEqual(resolvedOutcome(ZERO, 0));
  });

  it("returns published rows through pointsByWorkId", async () => {
    const result = await call("points-by-work-id", { work_id: BETA.workId });
    expect(pointKeys(result)).toEqual([`${BETA.workId}:b-1`, `${BETA.workId}:b-2`]);
  });
});
