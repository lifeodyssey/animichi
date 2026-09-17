import pg from "pg";
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import { hookTimeoutMs, SPIKE_SETUP_BUDGET, startTestPostgres, type TestPostgres } from "@animichi/test-postgres";
import { signedApp } from "../preflight-fixtures";
import { servePostgres } from "./neon-http-postgres";

// #1230 Phase 1 against a real PostgreSQL holding the committed chain: the
// promoted catalog is read back from the database, and the answer has to change
// when one of the three tables is not there. The green case alone would pass
// against a probe that answers "ok" unconditionally.

const ROUTE = "https://migrator.test/catalog-schema";
let plane: TestPostgres;

beforeAll(async () => { plane = await startTestPostgres({ database: "catalog_schema_probe", budget: SPIKE_SETUP_BUDGET }); },
  hookTimeoutMs(SPIKE_SETUP_BUDGET));
afterAll(async () => { await plane.stop(); });
afterEach(() => { vi.unstubAllGlobals(); });

/** One statement on the migrated database, outside the app's own reads. */
async function query(statement: string): Promise<void> {
  const client = new pg.Client({ connectionString: plane.dsn });
  await client.connect();
  try {
    await client.query(statement);
  } finally {
    await client.end();
  }
}

async function ask() {
  const { app, token, env } = await signedApp();
  return app.request(ROUTE, { headers: { authorization: `Bearer ${token}` } },
    { ...env, MIGRATOR_DATABASE_URL: plane.dsn });
}

it("reads the three tables back from the database the chain was applied to", async () => {
  const { captures } = servePostgres(plane.dsn);
  const response = await ask();
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    status: "ok",
    tables: { bangumi: true, points: true, ingest_jobs: true },
    missing: [],
  });
  const [capture] = captures;
  expect(capture?.readOnly).toBe("true");
  expect(capture?.isolation).toBe("RepeatableRead");
  expect(capture?.batch.queries.map(({ query }) => query)).toHaveLength(1);
});

it("names a table the database does not have, and clears once it is back", async () => {
  servePostgres(plane.dsn);
  expect((await ask()).status).toBe(200);
  await query("ALTER TABLE public.points RENAME TO points_hidden");
  const missing = await ask();
  expect(missing.status).toBe(422);
  expect(await missing.json()).toMatchObject({ status: "incomplete", missing: ["points"] });
  await query("ALTER TABLE public.points_hidden RENAME TO points");
  const restored = await ask();
  expect(restored.status).toBe(200);
  expect(await restored.json()).toMatchObject({ status: "ok", tables: { points: true } });
});

it("refuses a dropped table by name rather than reporting a boolean", async () => {
  servePostgres(plane.dsn);
  await query("DROP TABLE public.ingest_jobs");
  const response = await ask();
  expect(response.status).toBe(422);
  expect(await response.json()).toMatchObject({ missing: ["ingest_jobs"], tables: { ingest_jobs: false } });
});
