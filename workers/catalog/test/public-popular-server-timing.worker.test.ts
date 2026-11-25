import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CatalogRuntime } from "../src/db/prisma";
import type { Env } from "../src/index";
import { catalogRequest } from "./catalog-request";

// SUT: the `Server-Timing` header the catalog Worker answers `GET /catalog/public/popular` with, the
// read the staging CD requests after a deploy (`.github/scripts/catalog-first-request.sh`). On
// staging it names the database connect, the query and catalog's total, in milliseconds, and nothing
// else; no other environment sends it. Each case drives the whole Worker through `worker.fetch`. The
// connection is the one replaced seam, as in `public-popular-outbound.worker.test.ts`, and the clock
// is faked: each step moves it by its own amount a microtask after it was called, as I/O completes.

/** What each step takes on the faked clock, each a different amount, so a swapped segment shows. */
const SECRET_READ_MS = 5;
const CONNECT_MS = 40;
const QUERY_MS = 15;

/** The database a case answers with: how it connects and how it answers the ranking. */
const database = vi.hoisted(() => ({
  connect: (): Promise<void> => Promise.resolve(),
  answer: (): Promise<readonly unknown[]> => Promise.resolve([]),
}));

vi.mock("../src/db/prisma", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/db/prisma")>();
  const runtime = { query: () => database.answer(), [Symbol.asyncDispose]: (): Promise<void> => Promise.resolve() };
  const acquireCatalogRuntime = async (): Promise<CatalogRuntime> => {
    await database.connect();
    return runtime as unknown as CatalogRuntime;
  };
  return { ...real, acquireCatalogRuntime };
});

// Warmed in the import phase, for the reason `public-popular-outbound.worker.test.ts` gives.
import "../src/db/prisma";

const ROUTE = "/catalog/public/popular";
/** A URL each part of which would be a leak: a user, a password and a host. */
const DATABASE_URL = "postgresql://fixture:fixture-password@db.test/catalog";
const REQUEST_ID = "0f8b6c2e-3d4a-4b5c-8d9e-0a1b2c3d4e5f";
const RANKED = { id: "3302", title: "らき☆すた", title_cn: "幸运星", cover_url: null, city: "Kuki", points_count: 12, rating: 8.4 };
/** The whole header as metric names this Worker measures and their durations, nothing else. */
const NAMES_AND_MILLISECONDS = /^(db-connect|db-query|total);dur=\d+(\.\d+)?(,(db-connect|db-query|total);dur=\d+(\.\d+)?)*$/;

/** Resolve with `value` once `ms` has passed on the faked clock, a microtask after the call. */
function after<T>(ms: number, value: T): Promise<T> {
  return Promise.resolve().then(() => {
    vi.advanceTimersByTime(ms);
    return value;
  });
}

/** Reject with `error` once `ms` has passed, thrown inside the step so the caller's await handles it. */
function failingAfter(ms: number, error: Error): Promise<never> {
  return after(ms, error).then((failure) => {
    throw failure;
  });
}

/** Staging's bindings: its URL is a Secrets Store secret, and reading it takes time of its own. */
function staging(): Env {
  return { ENVIRONMENT: "staging", DATABASE_URL: { get: () => after(SECRET_READ_MS, DATABASE_URL) } };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["performance"] });
  database.connect = () => after(CONNECT_MS, undefined);
  database.answer = () => after(QUERY_MS, [RANKED]);
  vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("the popular read sends no request"))));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("GET /catalog/public/popular on staging", () => {
  it("answers the connect, the query and catalog's total, in the order they ran, in milliseconds", async () => {
    const response = await catalogRequest(ROUTE, {}, staging());

    expect(response.status).toBe(200);
    expect(response.headers.get("Server-Timing")).toBe("db-connect;dur=40.0,db-query;dur=15.0,total;dur=60.0");
  });

  it("still answers how long a refused connect took", async () => {
    database.connect = () => failingAfter(CONNECT_MS, new Error("connection refused"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await catalogRequest(ROUTE, {}, staging());

    expect(response.status).toBe(500);
    expect(response.headers.get("Server-Timing")).toBe("db-connect;dur=40.0,total;dur=45.0");
  });

  it("carries metric names and milliseconds only, though the query's error names the URL and its SQL", async () => {
    const error = new Error(`relation "bangumi" does not exist: select "id", "title" from "bangumi" on ${DATABASE_URL}`);
    database.answer = () => failingAfter(QUERY_MS, error);
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await catalogRequest(`${ROUTE}?limit=3`, { headers: { "X-Request-Id": REQUEST_ID } }, staging());

    expect(response.status).toBe(500);
    expect(response.headers.get("Server-Timing")).toMatch(NAMES_AND_MILLISECONDS);
  });
});

describe("GET /catalog/public/popular anywhere but staging", () => {
  it.each([
    { where: "production", env: { ENVIRONMENT: "production", DATABASE_URL } },
    { where: "a Worker with no ENVIRONMENT", env: { DATABASE_URL } },
  ])("answers no Server-Timing on $where", async ({ env }) => {
    const response = await catalogRequest(ROUTE, {}, env);

    expect(response.status).toBe(200);
    expect(response.headers.has("Server-Timing")).toBe(false);
  });
});
