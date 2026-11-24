import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CatalogRuntime } from "../src/db/prisma";
import type { Env } from "../src/index";
import { catalogRequest } from "./catalog-request";
import { planParams } from "./fakes/plan-inspection";
import { BEST_RANKED_IDS, SAME_NAME_PLACES, SHARED_NAME } from "./fixtures/same-name-places";

// SUT: the catalog Worker's `POST /catalog/geocode`, entered through `worker.fetch` with the request
// its one caller sends: the agent's nearby search asks for `{ query, limit: 5 }`
// (`packages/agent/src/search-nearby.ts`). The `/catalog/*` boundary, the oRPC handler, the router,
// the gazetteer's plan and the collapse all run as deployed. The connection is replaced, because
// the pool cannot open a socket: it records each plan and answers the exact tier with six places
// named 府中, one more than the agent's limit, so a five-place answer is the route's cap. The rows
// on the suite database are `geocode-route.integration.test.ts`.

/** The plans the request's connection was handed, in order, and the rows it answers each with. */
const connection = vi.hoisted(() => ({ executed: [] as { readonly ast: unknown }[], rows: [] as readonly unknown[] }));

vi.mock("../src/db/prisma", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/db/prisma")>();
  const query = (plan: { readonly ast: unknown }): Promise<readonly unknown[]> => {
    connection.executed.push(plan);
    return Promise.resolve(connection.rows);
  };
  const runtime = { query, [Symbol.asyncDispose]: (): Promise<void> => Promise.resolve() };
  return { ...real, acquireCatalogRuntime: () => Promise.resolve(runtime as unknown as CatalogRuntime) };
});

// The module graph is warmed here, in the file's import phase: loading it cold inside the first
// case spends that case's time budget (`prisma-connection.worker.test.ts`).
import "../src/db/prisma";

const DATABASE: Env = { DATABASE_URL: "postgresql://fixture@db.test/catalog" };

/** What the route answered, and the values each statement it ran bound, in order. */
async function geocode(input: { query: string; limit: number }): Promise<{ status: number; body: unknown; bound: unknown[][] }> {
  const response = await catalogRequest("/catalog/geocode", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input),
  }, DATABASE);
  return { status: response.status, body: await response.json(), bound: connection.executed.map(planParams) };
}

/** An answer whose candidates are these places, in this order. */
function candidates(ids: readonly string[]): { candidates: unknown[] } {
  return { candidates: ids.map((id): unknown => expect.objectContaining({ id })) };
}

beforeEach(() => {
  connection.executed.length = 0;
  connection.rows = SAME_NAME_PLACES;
  // A catalog route reaches its upstreams through `fetch`; nothing in this file may leave the machine.
  vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("this suite stubs every upstream"))));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("POST /catalog/geocode answers the agent's request from the gazetteer's exact read", () => {
  it("answers { query, limit: 5 } with the five best-ranked of six places, read once by the query", async () => {
    expect(await geocode({ query: SHARED_NAME, limit: 5 })).toEqual({
      status: 200,
      body: candidates(BEST_RANKED_IDS.slice(0, 5)),
      bound: [[SHARED_NAME]],
    });
  });

  it("answers limit 2, not the default of 5, with the two best-ranked in the shape the agent reads", async () => {
    expect(await geocode({ query: SHARED_NAME, limit: 2 })).toEqual({
      status: 200,
      body: {
        candidates: [
          { id: "seed:fuchu-tokyo", name: "府中", label: "府中(東京都)", lat: 35.6689, lng: 139.4776, kind: "city", source: "seed", effective_radius_m: 10_000 },
          { id: "seed:fuchu-hiroshima", name: "府中", label: "府中(広島県)", lat: 34.5683, lng: 133.2366, kind: "city", source: "seed", effective_radius_m: 10_000 },
        ],
      },
      bound: [[SHARED_NAME]],
    });
  });
});
