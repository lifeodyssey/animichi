import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MISSING_CATALOG_TABLES_SQL,
  readMissingCatalogTables,
  REQUIRED_CATALOG_TABLES,
} from "../src/catalog-tables";
import { FIXED_NOW, makeApp, testEnv } from "./migrate.worker.helpers";
import type { Hono } from "hono";
import type { Env } from "../src/create-app";

// #1230 Phase 1 — the promoted catalog read back at the HTTP seam. The release
// asks this once per environment after the chain applies; the answer has to
// name a missing table rather than report a boolean nobody can act on.

beforeEach(() => vi.useFakeTimers({ toFake: ["Date"], now: FIXED_NOW }));
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const DSN = "postgresql://fake:migrator@db.test/neondb";
const PRIVATE_MESSAGE = "postgresql://admin:secret@private.test/db SELECT secret FROM private";

function get(app: Hono<{ Bindings: Env }>, token?: string, env: Environment = testEnv()) {
  const headers: Record<string, string> = token === undefined ? {} : { authorization: `Bearer ${token}` };
  return app.request("https://migrator.test/catalog-schema", { headers }, env);
}

type Environment = Parameters<Hono<{ Bindings: Env }>["request"]>[2];

describe("GET /catalog-schema — the answer a release gates on", () => {
  it("reports ok when every required table exists", async () => {
    const { app, token } = await makeApp({ readMissingCatalogTables: () => Promise.resolve([]) });
    const response = await get(app, token);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: "ok",
      tables: { bangumi: true, points: true, ingest_jobs: true },
      missing: [],
    });
  });

  it("refuses with 422 and names the missing table", async () => {
    const { app, token } = await makeApp({ readMissingCatalogTables: () => Promise.resolve(["points"]) });
    const response = await get(app, token);
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({
      status: "incomplete",
      tables: { bangumi: true, points: false, ingest_jobs: true },
      missing: ["points"],
    });
  });

  it("names every missing table in a stable order", async () => {
    const { app, token } = await makeApp({
      readMissingCatalogTables: () => Promise.resolve(["ingest_jobs", "bangumi"]),
    });
    expect(await (await get(app, token)).json()).toMatchObject({ status: "incomplete", missing: ["bangumi", "ingest_jobs"] });
  });
});

describe("GET /catalog-schema — identity and unavailability", () => {
  it("is not anonymous", async () => {
    const probe = vi.fn(() => Promise.resolve([]));
    const { app } = await makeApp({ readMissingCatalogTables: probe });
    const response = await get(app);
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthorized" });
    expect(probe).not.toHaveBeenCalled();
  });

  it("answers 503 without reading when no DSN is bound", async () => {
    const probe = vi.fn(() => Promise.resolve([]));
    const { app, token } = await makeApp({ readMissingCatalogTables: probe });
    const response = await get(app, token, { ...testEnv(), MIGRATOR_DATABASE_URL: undefined });
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "schema_probe_unavailable" });
    expect(probe).not.toHaveBeenCalled();
  });

  it.each(["", "invalid-dsn"])("fails closed on the unresolvable DSN %s", async (dsn) => {
    const { app, token } = await makeApp();
    const response = await get(app, token, { ...testEnv(), MIGRATOR_DATABASE_URL: dsn });
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "schema_probe_unavailable" });
  });

  it("sanitizes a rejected secret binding without logging it", async () => {
    // observability is on at head_sampling_rate 1, so a console.error here ships the driver
    // exception — the DSN — off the worker. The count is the assertion, never the calls.
    const consoleError = vi.spyOn(console, "error").mockReturnValue(undefined);
    const { app, token } = await makeApp();
    const get1 = vi.fn(() => Promise.reject(new Error(PRIVATE_MESSAGE)));
    const response = await get(app, token, { ...testEnv(), MIGRATOR_DATABASE_URL: { get: get1 } });
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "schema_probe_unavailable" });
    expect(consoleError.mock.calls.length).toBe(0);
  });

  it("sanitizes a driver failure", async () => {
    const { app, token } = await makeApp({
      readMissingCatalogTables: () => Promise.reject(new Error(PRIVATE_MESSAGE)),
    });
    const response = await get(app, token);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "schema_probe_unavailable" });
  });
});

/** The native result envelope the Neon HTTP driver parses: fields name the columns. */
function nativeResult(rows: readonly string[][]): Response {
  return Response.json({ results: [{ fields: [{ name: "name", dataTypeID: 25 }], rows }] });
}

/** The driver's own request, captured so the read-only shape is asserted, not assumed. */
function serveBatch(response: () => Response) {
  const transport = vi.fn<typeof fetch>(() => Promise.resolve(response()));
  vi.stubGlobal("fetch", transport);
  return transport;
}

function batchOf(transport: ReturnType<typeof serveBatch>) {
  const call = transport.mock.calls[0];
  const body = JSON.parse(call?.[1]?.body as string) as { queries: { query: string }[] };
  return { headers: new Headers(call?.[1]?.headers), query: body.queries[0]?.query ?? "" };
}

describe("readMissingCatalogTables — the read behind the route", () => {
  it("sends the fixed statement in one read-only repeatable-read transaction", async () => {
    const transport = serveBatch(() => nativeResult([]));
    expect(await readMissingCatalogTables(DSN)).toEqual([]);
    const { headers, query } = batchOf(transport);
    expect(query).toBe(MISSING_CATALOG_TABLES_SQL);
    expect(headers.get("Neon-Batch-Read-Only")).toBe("true");
    expect(headers.get("Neon-Batch-Isolation-Level")).toBe("RepeatableRead");
    expect(headers.get("Neon-Connection-String")).toBe(DSN);
  });

  it("keeps one row per table in the statement itself", () => {
    for (const table of REQUIRED_CATALOG_TABLES) expect(MISSING_CATALOG_TABLES_SQL).toContain(`('${table}')`);
    expect(MISSING_CATALOG_TABLES_SQL).toContain("FROM (VALUES ('bangumi'), ('points'), ('ingest_jobs')) AS expected(name)");
  });

  it("returns the names the database answered with", async () => {
    serveBatch(() => nativeResult([["points"], ["ingest_jobs"]]));
    expect(await readMissingCatalogTables(DSN)).toEqual(["points", "ingest_jobs"]);
  });

  it.each([
    ["a rejected transport", () => { throw new Error("driver down"); }],
    ["a non-array result", () => Response.json({ results: [{ fields: [], rows: {} }] })],
    ["a row without a name", () => nativeResult([[undefined as unknown as string]])],
  ])("fails closed on %s", async (_name, response) => {
    serveBatch(response);
    await expect(readMissingCatalogTables(DSN)).rejects.toThrow();
  });
});
