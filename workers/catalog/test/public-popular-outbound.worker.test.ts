import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CatalogRuntime } from "../src/db/prisma";
import type { Env } from "../src/index";
import { BANGUMI_BASE } from "../src/ingest/upstream-requests";
import { catalogRequest } from "./catalog-request";

// SUT: the catalog Worker's `GET /catalog/public/popular`, the route the staging CD times right
// after its smoke. It reads the database and sends no outbound request on any branch: rows, an
// empty ranking, a failed read, a refused connection. Each case drives the whole Worker, so the
// public guard, the `/catalog/*` boundary that hands the route its `fetchImpl` and the handler all
// run; the interceptor records every `fetch` they make, and the first case proves, in the same run,
// that it catches one the catalog sends through that `fetchImpl`.

/** The database a case answers with: how it connects, how it answers, and how often it was read. */
const database = vi.hoisted(() => ({
  connect: (): Promise<void> => Promise.resolve(),
  answer: (): Promise<readonly unknown[]> => Promise.resolve([]),
  statements: 0,
}));

// The connection is a socket the pool cannot open, so acquiring it is the one replaced seam: the
// statement builder, the plan and everything above them are the Worker's own.
vi.mock("../src/db/prisma", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/db/prisma")>();
  const query = (): Promise<readonly unknown[]> => {
    database.statements += 1;
    return database.answer();
  };
  const runtime = { query, [Symbol.asyncDispose]: (): Promise<void> => Promise.resolve() };
  const acquireCatalogRuntime = async (): Promise<CatalogRuntime> => {
    await database.connect();
    return runtime as unknown as CatalogRuntime;
  };
  return { ...real, acquireCatalogRuntime };
});

// The module graph is warmed here, in the file's import phase: loading it cold inside the first
// case spends that case's time budget (`prisma-connection.worker.test.ts`).
import "../src/db/prisma";

const ROUTE = "/catalog/public/popular";
const DATABASE: Env = { DATABASE_URL: "postgresql://fixture@db.test/catalog" };
const RANKED = { title: "らき☆すた", title_cn: "幸运星", cover_url: null, city: "Kuki", points_count: 12, rating: 8.4 };

/** Every request the Worker sent during the case, as "METHOD url". */
const outbound: string[] = [];

/** Record a request and answer it as an empty Bangumi search, so a planted one completes. */
function recordOutbound(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const request = new Request(input, init);
  outbound.push(`${request.method} ${request.url}`);
  return Promise.resolve(Response.json({ data: [] }));
}

beforeEach(() => {
  outbound.length = 0;
  database.connect = () => Promise.resolve();
  database.answer = () => Promise.resolve([]);
  database.statements = 0;
  vi.stubGlobal("fetch", recordOutbound);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("the outbound interceptor", () => {
  it("catches the upstream search resolve sends through the route's fetchImpl on an alias miss", async () => {
    const response = await catalogRequest("/catalog/resolve", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query: "unknown" }),
    }, DATABASE);

    expect(response.status).toBe(200);
    expect(outbound).toEqual([expect.stringContaining(`POST ${BANGUMI_BASE}/`)]);
  });
});

describe("GET /catalog/public/popular sends no outbound request", () => {
  it("answers the ranking it read in one statement", async () => {
    database.answer = () => Promise.resolve([{ id: "3302", ...RANKED }]);

    const response = await catalogRequest(ROUTE, {}, DATABASE);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ bangumi: [{ bangumi_id: "3302", ...RANKED }] });
    expect(database.statements).toBe(1);
    expect(outbound).toEqual([]);
  });

  it("answers an empty ranking, which staging may hold, with an empty array", async () => {
    const response = await catalogRequest(ROUTE, {}, DATABASE);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ bangumi: [] });
    expect(database.statements).toBe(1);
    expect(outbound).toEqual([]);
  });

  it("answers a failed read with a 500, not a fallback to an upstream", async () => {
    database.answer = () => Promise.reject(new Error("the ranking statement failed"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await catalogRequest(ROUTE, {}, DATABASE);

    expect(response.status).toBe(500);
    expect(outbound).toEqual([]);
  });

  it("answers a refused connection with a 500, before any statement", async () => {
    database.connect = () => Promise.reject(new Error("connection refused"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await catalogRequest(ROUTE, {}, DATABASE);

    expect(response.status).toBe(500);
    expect(database.statements).toBe(0);
    expect(outbound).toEqual([]);
  });
});
