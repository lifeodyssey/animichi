import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CatalogRuntime } from "../src/db/prisma";
import type { Env } from "../src/index";
import { catalogRequest } from "./catalog-request";

// SUT: the catalog Worker's `/catalog/*` boundary (`src/index.ts`) handing a request's input to the
// shared contract. A GET procedure's input is its path and query, which arrive as text, so the
// request the web's popular ranking sends (`GET /catalog/public/popular?limit=8`,
// `apps/web/src/api/hooks/use-popular.ts`) has to reach `PopularInput`'s `z.number()` as a number. A
// POST procedure's input is its JSON body, which carries its own types, so a number sent there as
// the string "8" must still be refused. Each case drives the whole Worker through `worker.fetch`:
// the public guard, the oRPC handler with its plugins, the router and the statement it builds.

/** Every plan the request's connection was handed, in order. */
const executed = vi.hoisted((): { readonly ast: unknown }[] => []);

// The connection is a socket the pool cannot open, so acquiring it is the one replaced seam: the
// handler builds its plan with the Worker's own statement builder and hands it to this runtime.
vi.mock("../src/db/prisma", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/db/prisma")>();
  const query = (plan: { readonly ast: unknown }): Promise<readonly never[]> => {
    executed.push(plan);
    return Promise.resolve([]);
  };
  const runtime = { query, [Symbol.asyncDispose]: (): Promise<void> => Promise.resolve() };
  return { ...real, acquireCatalogRuntime: () => Promise.resolve(runtime as unknown as CatalogRuntime) };
});

// The module graph is warmed here, in the file's import phase: loading it cold inside the first
// case spends that case's time budget (`prisma-connection.worker.test.ts`).
import "../src/db/prisma";

const DATABASE: Env = { DATABASE_URL: "postgresql://fixture@db.test/catalog" };

/** What oRPC answers for input the contract refuses, today and after any coercion. */
const VALIDATION_FAILURE = { defined: false, code: "BAD_REQUEST", status: 400, message: "Input validation failed" };

/** The row cap (`LIMIT`) of each plan the request ran, in order; empty when it ran none. */
function caps(): unknown[] {
  return executed.map((plan) => (plan.ast as { readonly limit?: unknown }).limit);
}

/** A popularity read through the whole Worker: the body and status it answered, the caps it ran. */
async function popular(query: string): Promise<{ body: unknown; status: number; caps: unknown[] }> {
  const response = await catalogRequest(`/catalog/public/popular${query}`, {}, DATABASE);
  return { body: await response.json(), status: response.status, caps: caps() };
}

beforeEach(() => {
  executed.length = 0;
  // A catalog route reaches its upstreams through `fetch`; nothing in this file may leave the machine.
  vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("this suite stubs every upstream"))));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("GET /catalog/public/popular reads its limit as the contract's number", () => {
  it("caps the ranking read at the contract's default of 8 when no limit is sent", async () => {
    expect(await popular("")).toEqual({ body: { bangumi: [] }, status: 200, caps: [8] });
  });

  it("answers ?limit=3 with the ranking read capped at 3", async () => {
    expect(await popular("?limit=3")).toEqual({ body: { bangumi: [] }, status: 200, caps: [3] });
  });

  it("answers ?limit=8, the web's own request, with the ranking read capped at 8", async () => {
    expect(await popular("?limit=8")).toEqual({ body: { bangumi: [] }, status: 200, caps: [8] });
  });

  it.each(["?limit=abc", "?limit=0"])("refuses %s with the validation failure, before any statement", async (query) => {
    expect(await popular(query)).toMatchObject({ body: VALIDATION_FAILURE, status: 400, caps: [] });
  });
});

describe("a POST body reaches the contract as it was sent", () => {
  it("refuses geocode's numeric limit sent as the string \"8\", before any statement", async () => {
    const response = await catalogRequest("/catalog/geocode", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query: "西宮", limit: "8" }),
    }, DATABASE);

    expect({ body: await response.json(), status: response.status, statements: executed.length }).toMatchObject({
      body: { ...VALIDATION_FAILURE, data: { issues: [{ path: ["limit"], message: "Invalid input: expected number, received string" }] } },
      status: 400,
      statements: 0,
    });
  });
});
