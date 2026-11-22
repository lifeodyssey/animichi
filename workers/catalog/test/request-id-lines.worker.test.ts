import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { afterEach, describe, expect, it, vi } from "vitest";
import { catalogRouter, type CatalogContext } from "../src/router";
import { fakeCatalogPrisma } from "./fakes/fake-catalog-prisma";

/**
 * SUT: the lines catalog writes for a routed request — `resolve` and `plan-itinerary`
 * (`src/router.ts`) and `nearby` (`src/adapters/inbound/nearby.ts`). Each carries the gateway's
 * request ID from the request's context as `request_id=`, and `-` when the request brought none,
 * as the SessionAgent's own catalog calls do today. `index.ts` fills the context from the
 * `X-Request-Id` header; that half is driven through the whole app in
 * `request-id.integration.test.ts`.
 */

/** A request ID as the gateway mints it: a lowercase UUID. */
const GATEWAY_ID = "6f1a4c2e-8f3b-4d5a-9c7e-2b1d0a4e5f60";

const handler = new OpenAPIHandler(catalogRouter);

/** What one routed POST writes to `console.info`. */
async function linesOf(path: string, body: unknown, context: CatalogContext): Promise<string> {
  const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
  const request = new Request(`https://catalog.test/catalog/${path}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
  const { matched } = await handler.handle(request, { context });
  expect(matched).toBe(true);
  return info.mock.calls.map((call) => String(call[0])).join("\n");
}

/** An exact alias hit, then its stored candidate: resolve answers without the upstream. */
const RESOLVE_ROWS = [
  [{ bangumi_id: "3302", priority: 40 }],
  [{ id: "3302", title: "らき☆すた", title_cn: null, cover_url: null, air_date: null, points_count: 0 }],
];

/** One point, as the itinerary's plan projects it. */
const ITINERARY_ROW = {
  id: "a", name: "A", name_cn: null, bangumi_id: "k", episode: null, time_seconds: null, image: "a.jpg",
  latitude: 35.0, longitude: 135.0, origin: null, origin_url: null, title: "Lucky Star", title_cn: null,
  cover_url: null, city: "Tokyo",
};

/** Each request line: its name, its route, a body the route accepts, the rows its plans read. */
const LINES: [string, string, unknown, unknown[][]][] = [
  ["resolve", "resolve", { query: "Lucky Star" }, RESOLVE_ROWS],
  ["plan-itinerary", "itinerary", { point_ids: ["a"] }, [[ITINERARY_ROW]]],
  ["nearby", "nearby", { lat: 36.1, lng: 139.6, radius_m: 5000 }, [[]]],
];

afterEach(() => { vi.restoreAllMocks(); });

describe("the gateway's request ID on catalog's request lines", () => {
  it.each(LINES)("the %s line carries the request's ID", async (_line, path, body, rows) => {
    const line = await linesOf(path, body, { prisma: fakeCatalogPrisma(...rows), requestId: GATEWAY_ID });
    expect(line).toContain(`request_id=${GATEWAY_ID}`);
  });

  it.each(LINES)("the %s line says so when the request brought no ID", async (_line, path, body, rows) => {
    const line = await linesOf(path, body, { prisma: fakeCatalogPrisma(...rows) });
    expect(line).toContain("request_id=-");
  });
});
